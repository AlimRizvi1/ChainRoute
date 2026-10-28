// Local demo only: creates synthetic records through the real platform API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const http = require('node:http');
const requireApp = createRequire('/app/package.json');
const { Pool } = requireApp('pg');
const { JsonRpcProvider } = requireApp('ethers');
if (process.env.NODE_ENV === 'production') throw new Error('Frontend demo data is disabled in production.');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const chain = new JsonRpcProvider(process.env.CHAIN_RPC_URL || 'http://blockchain:8545');
const tokens = {};
const sessionPath = '/demo-data/.sessions.json';
const recordPath = '/demo-data/frontend-demo.json';
const record = fs.existsSync(recordPath) ? JSON.parse(fs.readFileSync(recordPath, 'utf8')) : { synthetic: true, scenarios: {}, pendingOrderIds: [] };
const iso = (seconds) => new Date(seconds * 1000).toISOString();
function save() { fs.writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n'); }
async function api(method, path, role, body, key, status = 200) {
  const response = await fetch(`http://backend:8080${path}`, {
    method, headers: { ...(role ? { authorization: `Bearer ${tokens[role]}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}), ...(key ? { 'idempotency-key': key } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(90000),
  });
  const result = await response.json();
  assert.equal(response.status, status, `${method} ${path}: ${path.startsWith('/auth') ? 'Sign-in failed; check the existing demo password.' : JSON.stringify(result)}`);
  return result;
}
async function chainTime() { return Number(BigInt((await chain.send('eth_getBlockByNumber', ['latest', false])).timestamp)); }
function frontendGet(path, role) {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: 'dashboard', port: 5173, path: `/api${path}`,
      headers: { host: 'localhost:5173', authorization: `Bearer ${tokens[role]}` } }, (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try { assert.equal(response.statusCode, 200, `Frontend proxy ${path}`); resolve(JSON.parse(body)); }
        catch (error) { reject(error); }
      });
    });
    request.on('error', reject);
    request.setTimeout(15000, () => request.destroy(new Error('Frontend proxy timed out')));
    request.end();
  });
}
async function scenario(name, cargoType, quantityTonnes, target, freightValuePaise) {
  const marker = `frontend-demo-v1-${name}`;
  const existing = await pool.query("SELECT c.contract_id, c.plan_id, c.state FROM contracts c JOIN contract_operations op ON op.contract_id=c.contract_id WHERE op.action='accept' AND op.idempotency_key=$1 AND op.status='succeeded'", [marker]);
  if (existing.rowCount) {
    record.scenarios[name] = { contractId: existing.rows[0].contract_id, planId: existing.rows[0].plan_id, state: existing.rows[0].state };
    save(); return;
  }
  // Leave a feasible planning horizon before simulating a 13-hour late delivery.
  // Active contracts and pending orders are created after this clock advance.
  await chain.send('evm_mine', []);
  const deadline = Math.max(await chainTime(), Math.floor(Date.now() / 1000)) + (target === 'Closed' ? 60 * 3600 : 4 * 86400);
  const order = await api('POST', '/orders', 'shipper', { cargoType, quantityTonnes, destination: 'Port-A', priority: 1, deadline: iso(deadline) }, undefined, 201);
  const plan = await api('POST', '/optimizations/run', 'shipper', { weights: { onTime: 0.5, cost: 0.3, utilization: 0.2 }, timeBudgetSeconds: 0.5 });
  assert.ok(plan.assignments.some((a) => a.orderId === order.orderId), 'Demo order must be assigned by the real engine');
  const wagonCount = plan.assignments.reduce((n, a) => n + a.wagonIds.length, 0);
  const accepted = await api('POST', `/plans/${plan.planId}/accept`, 'shipper', {
    carrierAddress: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    terms: { freightValuePaise, penaltyBpsPerBlock: 200, penaltyBlockSeconds: 21600,
      freeHoldingHours: 6, demurrageRatePaisePerWagonHour: '500', wagonCount },
  }, marker);
  const id = accepted.contractId;
  if (target !== 'Created') {
    await api('POST', `/contracts/${id}/confirm-booking`, 'carrier', undefined, `${marker}-booking`);
    const dispatchedAt = await chainTime();
    await api('POST', `/contracts/${id}/shipment-status`, 'carrier', { status: 'Dispatched', timestamp: iso(dispatchedAt) }, `${marker}-dispatch`);
    if (target === 'Closed') {
      await api('POST', `/contracts/${id}/shipment-status`, 'carrier', { status: 'ArrivedAtDestination', timestamp: iso(deadline + 3 * 3600) }, `${marker}-arrival`);
      await chain.send('evm_setNextBlockTimestamp', [deadline + 13 * 3600 + 1]);
      await chain.send('evm_mine', []);
      const delivered = await api('POST', `/contracts/${id}/confirm-delivery`, 'carrier', { timestamp: iso(deadline + 13 * 3600), podReference: 'SYNTHETIC-DEMO-POD-LATE' }, `${marker}-delivery`);
      assert.deepEqual([delivered.penaltyPaise, delivered.demurragePaise, delivered.netPaymentPaise], ['150000', '24000', '2326000']);
      await api('POST', `/contracts/${id}/release-payment`, 'administrator', undefined, `${marker}-release`);
      await api('POST', `/contracts/${id}/close`, 'administrator', undefined, `${marker}-close`);
    } else if (target === 'PenaltyCalculated') {
      // Same-day delivery without an arrival hold, leaving payment available
      // for an Administrator to release in the frontend.
      await api('POST', `/contracts/${id}/confirm-delivery`, 'carrier', { timestamp: iso(await chainTime()), podReference: 'SYNTHETIC-DEMO-POD-ONTIME' }, `${marker}-delivery`);
    }
  }
  const detail = await api('GET', `/contracts/${id}`, 'shipper');
  assert.equal(detail.state, target);
  record.scenarios[name] = { contractId: id, planId: plan.planId, state: detail.state };
  save(); console.log(`Synthetic demo: contract ${id} · ${target}`);
}
async function main() {
  if (fs.existsSync(sessionPath)) {
    const saved = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    if (saved.expiresAt > Date.now()) Object.assign(tokens, saved.tokens);
  }
  for (const role of ['shipper', 'carrier', 'administrator', 'auditor']) {
    if (!tokens[role]) {
      tokens[role] = (await api('POST', '/auth/login', undefined, { username: `demo.${role}`, password: process.env.DEMO_USER_PASSWORD })).token;
      fs.writeFileSync(sessionPath, JSON.stringify({ tokens, expiresAt: Date.now() + 840000 }), { mode: 0o600 });
    }
  }
  // Do not consume or lock unrelated user-entered pending orders while seeding.
  const pending = await pool.query("SELECT count(*)::int AS count FROM orders o JOIN users u ON u.user_id=o.created_by WHERE u.username='demo.shipper' AND o.status='Pending'");
  const alreadySeeded = await pool.query("SELECT count(*)::int AS count FROM contract_operations WHERE action='accept' AND idempotency_key LIKE 'frontend-demo-v1-%' AND status='succeeded'");
  if (pending.rows[0].count && !alreadySeeded.rows[0].count) {
    throw new Error('demo.shipper already has pending orders. Seed stopped to preserve them; run those orders first.');
  }
  await scenario('late-settled', 'coal', 240, 'Closed', '2500000');
  await scenario('payment-ready', 'grain', 80, 'PenaltyCalculated', '1800000');
  await scenario('on-the-way', 'grain', 100, 'InTransit', '3200000');
  await scenario('ready-for-booking', 'steel', 60, 'Created', '1500000');
  const queue = [ ['grain', 60, 'Port-A', 1], ['coal', 120, 'Plant-B', 2], ['steel', 40, 'Depot-C', 1],
    ['grain', 80, 'Port-D', 3], ['coal', 100, 'Port-A', 2], ['steel', 60, 'Plant-B', 3] ];
  if (!record.pendingOrderIds.length) {
    const deadline = Math.max(await chainTime(), Math.floor(Date.now() / 1000)) + 7 * 86400;
    for (const [cargoType, quantityTonnes, destination, priority] of queue) {
      const order = await api('POST', '/orders', 'shipper', { cargoType, quantityTonnes, destination, priority, deadline: iso(deadline) }, undefined, 201);
      record.pendingOrderIds.push(order.orderId); save();
    }
  }
  record.summary = await api('GET', '/dashboard/summary', 'shipper');
  const contracts = await api('GET', '/contracts', 'carrier');
  assert.ok(contracts.items.length >= 4);
  const auditor = await api('GET', `/contracts/${record.scenarios['late-settled'].contractId}`, 'auditor');
  assert.equal(Object.hasOwn(auditor, 'terms'), false);
  const frontendSummary = await frontendGet('/dashboard/summary', 'shipper');
  assert.deepEqual(frontendSummary, record.summary);
  for (const role of ['shipper', 'carrier', 'administrator', 'auditor']) {
    const visibleContracts = await frontendGet('/contracts', role);
    assert.ok(visibleContracts.items.length >= 4, `${role} sees the demo ledger through the frontend proxy`);
  }
  record.frontendProxyVerified = true;
  record.seededAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ synthetic: true, scenarios: record.scenarios, summary: record.summary }, null, 2));
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(async () => { await pool.end(); await chain.destroy(); });
