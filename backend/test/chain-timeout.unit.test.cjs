const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { test } = require('node:test');
const { openSettlement } = require('../dist/contracts/chain.js');

test('an unresponsive RPC is bounded so contract writes can enter the durable queue', { timeout: 12000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chainroute-timeout-'));
  const server = createServer((_request, _response) => { /* deliberately never responds */ });
  try {
    const artifactPath = join(directory, 'contract.json');
    await writeFile(artifactPath, JSON.stringify({ contractName: 'ChainRouteSettlement',
      address: `0x${'1'.repeat(40)}`, chainId: 31337, abi: [] }));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const started = performance.now();
    await assert.rejects(openSettlement(`http://127.0.0.1:${server.address().port}`, artifactPath), /timeout/i);
    assert.ok(performance.now() - started < 7500, 'network detection must not wait for the ethers default timeout');
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
