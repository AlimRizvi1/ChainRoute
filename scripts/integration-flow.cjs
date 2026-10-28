// Runs inside the built backend image; requires no host Node installation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const { performance } = require('node:perf_hooks');
const requireApp = createRequire('/app/package.json');
const { Contract, JsonRpcProvider, keccak256, toUtf8Bytes } = requireApp('ethers');
const { Pool } = requireApp('pg');
const { canonicalJson } = requireApp('/app/dist/contracts/chain.js');
const reportPath = '/evidence/report.json';
const report = fs.existsSync(reportPath) && process.argv[2] !== 'ai-outage'
  ? JSON.parse(fs.readFileSync(reportPath, 'utf8'))
  : { startedAt: new Date().toISOString(), checks: [], scenarios: {}, pending: [
      'Browser recording and responsive/keyboard review of the full dashboard workflow.',
      'Unfamiliar-user walkthrough and execution on another machine.',
    ] };
const tokens = {};
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const provider = new JsonRpcProvider('http://blockchain:8545');
const artifact = JSON.parse(fs.readFileSync('/shared/contract.json', 'utf8'));
const contract = new Contract(artifact.address, artifact.abi, provider);
const iso = (seconds) => new Date(seconds * 1000).toISOString();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function record(name, evidence) {
  report.checks.push({ name, passed: true, evidence });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`PASS ${name}`);
}
async function request(method, path, role, body, expected = 200, key) {
  const response = await fetch(`http://backend:8080${path}`, {
    method, headers: { ...(role ? { authorization: `Bearer ${tokens[role]}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(key ? { 'idempotency-key': key } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(90000),
  });
  const text = await response.text();
  // Do not include credential-bearing response bodies in assertions or reports.
  assert.equal(response.status, expected, `${method} ${path}: expected ${expected}, got ${response.status}${path.startsWith('/auth') ? '' : ` ${text}`}`);
  return response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text;
}
async function login() {
  const sessionPath = '/evidence/sessions.json';
  if (process.argv[2] !== 'ai-outage' && fs.existsSync(sessionPath)) {
    const saved = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    if (saved.expiresAt > Date.now()) { Object.assign(tokens, saved.tokens); return; }
  }
  for (const role of ['shipper', 'carrier', 'administrator', 'auditor']) {
    const session = await request('POST', '/auth/login', undefined,
      { username: `demo.${role}`, password: process.env.DEMO_USER_PASSWORD });
    tokens[role] = session.token;
  }
  // Local, ignored artifact only. Tokens never enter the public evidence report.
  fs.writeFileSync(sessionPath, JSON.stringify({ tokens, expiresAt: Date.now() + 840000 }), { mode: 0o600 });
}
async function waitFor(check, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const value = await check(); if (value) return value; await sleep(1000); }
  throw new Error('Timed out waiting for event sync or queued operation');
}
async function assertState(id, name, numeric) {
  const detail = await request('GET', `/contracts/${id}`, 'shipper');
  assert.equal(detail.state, name);
  const chain = await contract.getFunction('getContractStatus')(BigInt(id));
  assert.equal(Number(chain[0].state), numeric);
  return detail;
}
async function createScenario(name) {
  const block = await provider.getBlock('latest');
  const deadline = Number(block.timestamp) + 60 * 3600;
  const order = await request('POST', '/orders', 'shipper', {
    cargoType: 'coal', quantityTonnes: 240, destination: 'Port-A', priority: 1, deadline: iso(deadline),
  }, 201);
  const plan = await request('POST', '/optimizations/run', 'shipper', {
    weights: { onTime: 1, cost: 1, utilization: 1 }, timeBudgetSeconds: 0.5,
  });
  const wagonCount = plan.assignments.reduce((n, a) => n + a.wagonIds.length, 0);
  assert.equal(wagonCount, 12, 'Canonical terms require 12 20-tonne wagons');
  assert.equal(plan.assignments.length, 1);
  assert.equal(plan.assignments[0].orderId, order.orderId);
  for (const metric of ['utilizationPercent', 'estimatedCostPaise', 'distanceKm', 'onTimeProbability']) assert.ok(Object.hasOwn(plan.metrics, metric));
  assert.equal(plan.runMetadata.prediction.method, 'logistic_regression');
  const locked = await pool.query('SELECT status FROM orders WHERE order_id = $1', [order.orderId]);
  assert.equal(locked.rows[0].status, 'Planned');
  const traceResponse = await fetch(`http://ai-engine:8000/v1/runs/${plan.runId}`);
  assert.equal(traceResponse.status, 200);
  const whatIf = await request('POST', '/optimizations/run', 'shipper', {
    sourcePlanId: plan.planId, weights: { onTime: 0, cost: 1, utilization: 0 }, timeBudgetSeconds: 0.5,
  });
  assert.deepEqual(whatIf.runMetadata.weights, { onTime: 0, cost: 1, utilization: 0 });
  const snapshots = await pool.query('SELECT input_snapshot FROM optimization_runs WHERE run_id = ANY($1::text[])', [[plan.runId, whatIf.runId]]);
  assert.equal(snapshots.rowCount, 2);
  assert.deepEqual(snapshots.rows[0].input_snapshot.orders, snapshots.rows[1].input_snapshot.orders);
  record(`${name}: order, ML plan, locked order, metrics, saved-snapshot what-if`, { orderId: order.orderId, planId: plan.planId, runId: plan.runId, metrics: plan.metrics, whatIfPlanId: whatIf.planId });
  const terms = { freightValuePaise: '2500000', penaltyBpsPerBlock: 200, penaltyBlockSeconds: 21600,
    freeHoldingHours: 6, demurrageRatePaisePerWagonHour: '500', wagonCount };
  const acceptBody = { carrierAddress: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', terms };
  const acceptKey = `${name}-accept`;
  const accepted = await request('POST', `/plans/${plan.planId}/accept`, 'shipper', acceptBody, 200, acceptKey);
  const repeated = await request('POST', `/plans/${plan.planId}/accept`, 'shipper', acceptBody, 200, acceptKey);
  assert.deepEqual(repeated, accepted);
  const id = accepted.contractId;
  const detail = await assertState(id, 'Created', 0);
  const chain = await contract.getFunction('getContractStatus')(BigInt(id));
  const hash = keccak256(toUtf8Bytes(canonicalJson({ planId: plan.planId,
    shipper: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    carrier: acceptBody.carrierAddress, terms: detail.terms })));
  assert.equal(chain[0].terms.termsHash, detail.termsHash);
  assert.equal(hash, detail.termsHash);
  const created = await contract.queryFilter(contract.filters.AgreementCreated(BigInt(id)));
  assert.equal(created.length, 1);
  const stored = await pool.query('SELECT count(*)::int AS count FROM contracts WHERE plan_id = $1', [plan.planId]);
  assert.equal(stored.rows[0].count, 1);
  record(`${name}: accept replay creates exactly one agreement; terms hash matches chain`, { contractId: id, termsHash: hash });
  await request('POST', `/contracts/${id}/confirm-booking`, 'auditor', undefined, 403, `${name}-forbidden`);
  await request('POST', `/contracts/${id}/confirm-booking`, 'carrier', undefined, 200, `${name}-booking`);
  await assertState(id, 'Booked', 1);
  const bookedBlock = await provider.send('eth_getBlockByNumber', ['latest', false]);
  await request('POST', `/contracts/${id}/shipment-status`, 'carrier', { status: 'Dispatched', timestamp: iso(Number(BigInt(bookedBlock.timestamp))) }, 200, `${name}-dispatch`);
  await assertState(id, 'InTransit', 2);
  const arrival = name === 'late' ? deadline + 3 * 3600 : deadline - 3600;
  const delivery = name === 'late' ? deadline + 13 * 3600 : deadline;
  await request('POST', `/contracts/${id}/shipment-status`, 'carrier', { status: 'ArrivedAtDestination', timestamp: iso(arrival) }, 200, `${name}-arrival`);
  await assertState(id, 'InTransit', 2);
  await provider.send('evm_setNextBlockTimestamp', [delivery + 1]);
  await provider.send('evm_mine', []);
  const scenario = { id, planId: plan.planId, deadline, deliveryBody: { timestamp: iso(delivery), podReference: `pod-phase26-${name}` } };
  report.scenarios[name] = scenario;
  record(`${name}: booking and shipment transitions match chain`, { contractId: id, state: 'InTransit', arrival: iso(arrival) });
  return scenario;
}
async function verifyDelivery(name) {
  const s = report.scenarios[name];
  const expected = name === 'late' ? ['150000', '24000', '2326000'] : ['0', '0', '2500000'];
  const delivered = await request('POST', `/contracts/${s.id}/confirm-delivery`, 'carrier', s.deliveryBody, 200, `${name}-delivery`);
  assert.deepEqual([delivered.penaltyPaise, delivered.demurragePaise, delivered.netPaymentPaise], expected);
  assert.equal(delivered.onTime, name !== 'late');
  await assertState(s.id, 'PenaltyCalculated', 4);
  if (name === 'late') {
    await request('POST', `/contracts/${s.id}/dispute`, 'shipper', { reasonCode: 'PHASE26_REVIEW' }, 200, 'late-dispute');
    await assertState(s.id, 'Disputed', 7);
    await request('POST', `/contracts/${s.id}/release-payment`, 'administrator', undefined, 409, 'blocked-dispute-release');
    await request('POST', `/contracts/${s.id}/resolve-dispute`, 'administrator', { outcome: 'UpholdDeductions' }, 200, 'late-resolve');
    await assertState(s.id, 'PenaltyCalculated', 4);
  }
  const released = await request('POST', `/contracts/${s.id}/release-payment`, 'administrator', undefined, 200, `${name}-release`);
  assert.equal(released.netPaymentPaise, expected[2]);
  assert.match(released.transactionHash, /^0x[0-9a-f]{64}$/i);
  await assertState(s.id, 'PaymentReleased', 5);
  const replay = await request('POST', `/contracts/${s.id}/release-payment`, 'administrator', undefined, 200, `${name}-release`);
  assert.deepEqual(replay, released);
  await request('POST', `/contracts/${s.id}/release-payment`, 'administrator', undefined, 409, `${name}-release-another-key`);
  await request('POST', `/contracts/${s.id}/close`, 'administrator', undefined, 200, `${name}-close`);
  await assertState(s.id, 'Closed', 6);
  await request('POST', `/contracts/${s.id}/shipment-status`, 'carrier', { status: 'CheckpointReached', timestamp: s.deliveryBody.timestamp }, 409, `${name}-after-close`);
  const events = await waitFor(async () => {
    const detail = await request('GET', `/contracts/${s.id}`, 'shipper');
    return detail.history.some((e) => e.action === 'ContractClosed') ? detail.history : null;
  });
  const auditor = await request('GET', `/contracts/${s.id}`, 'auditor');
  for (const key of ['terms', 'assignments', 'penaltyPaise', 'demurragePaise', 'netPaymentPaise']) assert.equal(Object.hasOwn(auditor, key), false);
  const chainHistory = (await contract.getFunction('getContractStatus')(BigInt(s.id)))[1];
  const names = ['AgreementCreated','BookingConfirmed','ShipmentStatusUpdated','DeliveryConfirmed','PenaltyCalculated','DemurrageCalculated','PaymentReleased','DisputeRaised','DisputeResolved','ContractClosed'];
  assert.deepEqual(auditor.history.map((e) => e.action), chainHistory.map((e) => names[Number(e.action)]));
  assert.deepEqual(auditor.history.map((e) => e.dataHash), chainHistory.map((e) => e.dataHash));
  if (name === 'late') {
    const before = await pool.query('SELECT count(*)::int AS count FROM contract_events WHERE contract_id = $1', [s.id]);
    await pool.query("UPDATE contract_events SET data_hash = $1 WHERE contract_event_id = (SELECT contract_event_id FROM contract_events WHERE contract_id = $2 AND action = 'ShipmentStatusUpdated' ORDER BY block_number, log_index LIMIT 1)", [`0x${'0'.repeat(64)}`, s.id]);
    await pool.query("UPDATE chain_sync_state SET last_synced_block = 0 WHERE sync_name = 'settlement'");
    await waitFor(async () => {
      const repaired = await request('GET', `/contracts/${s.id}`, 'auditor');
      return JSON.stringify(repaired.history.map((e) => e.dataHash)) === JSON.stringify(chainHistory.map((e) => e.dataHash));
    });
    const after = await pool.query('SELECT count(*)::int AS count FROM contract_events WHERE contract_id = $1', [s.id]);
    assert.equal(after.rows[0].count, before.rows[0].count);
    record('Event replay repairs a corrupted repeated-action hash without duplicate events', { contractId: s.id, events: after.rows[0].count });
  }
  const deliveries = await contract.queryFilter(contract.filters.DeliveryConfirmed(BigInt(s.id)));
  const payments = await contract.queryFilter(contract.filters.PaymentReleased(BigInt(s.id)));
  assert.equal(deliveries.length, 1);
  assert.equal(payments.length, 1);
  const payment = await pool.query('SELECT net_paise::text, transaction_hash, released_at, closed_at FROM payments WHERE contract_id = $1', [s.id]);
  assert.equal(payment.rows[0].net_paise, expected[2]);
  assert.ok(payment.rows[0].released_at && payment.rows[0].closed_at && payment.rows[0].transaction_hash);
  record(`${name}: exact settlement, one delivery/payment, replay protection, terminal state, audit privacy/history`, {
    contractId: s.id, penaltyPaise: expected[0], demurragePaise: expected[1], netPaymentPaise: expected[2],
    paymentTransactionHash: released.transactionHash, events, auditorHistory: auditor.history,
  });
}
async function main() {
  await login();
  switch (process.argv[2]) {
    case 'refresh-sessions': { console.log('Local validation sessions refreshed.'); break; }
    case 'ai-outage': {
      const counts = await pool.query('SELECT (SELECT count(*)::int FROM orders) AS orders, (SELECT count(*)::int FROM contracts) AS contracts');
      assert.deepEqual(counts.rows[0], { orders: 0, contracts: 0 });
      const tables = await pool.query('SELECT name FROM schema_migrations ORDER BY version');
      record('Clean dedicated PostgreSQL database migrated and seeded automatically', { migrations: tables.rows });
      const health = await request('GET', '/health');
      assert.equal(health.status, 'degraded'); assert.equal(health.dependencies.aiEngine, 'down');
      // An unrouteable order remains pending and cannot affect canonical allocations.
      const intake = await request('POST', '/orders', 'shipper', { cargoType: 'coal', quantityTonnes: 1, destination: 'Outage-only', priority: 3, deadline: new Date(Date.now() + 86400000).toISOString() }, 201);
      await request('POST', '/optimizations/run', 'shipper', { weights: { onTime: 1, cost: 1, utilization: 1 }, timeBudgetSeconds: 0.5 }, 503);
      const partial = await pool.query('SELECT count(*)::int AS count FROM allocation_plans'); assert.equal(partial.rows[0].count, 0);
      // Remove only this synthetic drill order so the two canonical plans each contain one order.
      await pool.query('DELETE FROM orders WHERE order_id = $1 AND status = $2', [intake.orderId, 'Pending']);
      record('AI stopped: degraded health, order intake 201, optimization 503, no partial plan', { orderId: intake.orderId });
      break;
    }
    case 'prepare-late': {
      assert.equal((await request('GET', '/health')).status, 'ok');
      await createScenario('late'); break;
    }
    case 'queue-delivery': {
      const s = report.scenarios.late;
      const queued = await request('POST', `/contracts/${s.id}/confirm-delivery`, 'carrier', s.deliveryBody, 202, 'late-delivery');
      assert.equal(queued.status, 'queued');
      const cached = await request('GET', `/contracts/${s.id}`, 'shipper'); assert.equal(cached.state, 'InTransit');
      report.queuedOperationId = queued.operationId;
      record('Chain process stopped: delivery durably queued and cached reads remain available', { operationId: queued.operationId });
      break;
    }
    case 'finish': {
      await waitFor(async () => {
        const op = await pool.query('SELECT status FROM contract_operations WHERE operation_id = $1', [report.queuedOperationId]);
        return op.rows[0]?.status === 'succeeded';
      });
      record('Node process restarted: persisted history survives and queued delivery completes automatically', { operationId: report.queuedOperationId });
      await verifyDelivery('late');
      await createScenario('onTime'); await verifyDelivery('onTime');
      const latencies = [];
      for (let i = 0; i < 50; i++) { const start = performance.now(); await request('GET', '/contracts', 'shipper'); latencies.push(performance.now() - start); }
      latencies.sort((a, b) => a - b);
      const p95 = latencies[Math.ceil(latencies.length * 0.95) - 1]; assert.ok(p95 < 500, `Contract-list p95 ${p95}ms exceeds 500ms`);
      record('50 HTTP contract-list requests p95 <500ms', { p95Milliseconds: p95 });
      report.completedAt = new Date().toISOString(); report.automatedApiResult = 'passed';
      fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
      break;
    }
    default: throw new Error('Unknown validation stage');
  }
}
main().catch((error) => {
  report.failure = { stage: process.argv[2], message: error.message, at: new Date().toISOString() };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`); console.error(error); process.exitCode = 1;
}).finally(async () => { await pool.end(); await provider.destroy(); });
