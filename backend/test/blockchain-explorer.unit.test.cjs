const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const Fastify = require('fastify');
const { registerBlockchainExplorer } = require('../dist/platform/blockchain.js');

test('explorer bounds windows, omits transaction calldata, and limits mining to the local development chain', async t => {
  let chain = '0x7a69', mined = 0;
  const block = { number:'0x4', hash:'0x'+'4'.repeat(64), parentHash:'0x'+'3'.repeat(64), timestamp:'0x65000000', stateRoot:'state', transactionsRoot:'transactions', receiptsRoot:'receipts', gasUsed:'0x5208', gasLimit:'0x100000', baseFeePerGas:'0x1', size:'0xff', miner:'miner', nonce:'0x0', transactions:['0xtransaction'], secretCommercialInput:'not exposed' };
  const server = createServer(async (req,res) => {
    let raw=''; for await (const chunk of req) raw+=chunk;
    const call=JSON.parse(raw);
    let result;
    if(call.method==='eth_chainId') result=chain;
    if(call.method==='eth_blockNumber') result='0x4';
    if(call.method==='web3_clientVersion') result='local-test';
    if(call.method==='eth_getBlockByNumber') { assert.equal(call.params[1], false); result={...block,number:call.params[0]}; }
    if(call.method==='evm_mine') { mined++; result='0x0'; }
    res.setHeader('content-type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:1,result}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const app=Fastify(); app.addHook('preHandler',async request=>{request.actor={role:'Administrator'};});
  registerBlockchainExplorer(app,`http://127.0.0.1:${server.address().port}`,'/missing-artifact');
  t.after(async()=>{await app.close(); await new Promise(resolve=>server.close(resolve));});
  const response=await app.inject('/blockchain/blocks?limit=2'); assert.equal(response.statusCode,200);
  const data=response.json(); assert.deepEqual(data.blocks.map(b=>b.number),[3,4]); assert.equal(data.nextBefore,2); assert.equal(data.canMine,true);
  assert.equal(data.blocks[0].gasUsed,'21000'); assert.equal(data.blocks[0].secretCommercialInput,undefined);
  assert.equal(data.genesis.number,0); assert.equal(data.genesis.timestamp,new Date(0x65000000*1000).toISOString());
  const first=(await app.inject('/blockchain/blocks?from=0&limit=2')).json();
  assert.deepEqual(first.blocks.map(b=>b.number),[0,1]); assert.equal(first.nextFrom,2); assert.equal(first.nextBefore,null);
  const next=(await app.inject('/blockchain/blocks?from=2&limit=2')).json();
  assert.deepEqual(next.blocks.map(b=>b.number),[2,3]); assert.equal(next.nextFrom,4);
  assert.equal((await app.inject('/blockchain/blocks?from=0&before=4')).statusCode,400);
  assert.equal((await app.inject('/blockchain/blocks?from=-1')).statusCode,400);
  assert.equal((await app.inject('/blockchain/blocks?limit=21')).statusCode,400);
  assert.equal((await app.inject('/blockchain/blocks?before=-1')).statusCode,400);
  assert.equal((await app.inject({method:'POST',url:'/blockchain/demo-block'})).statusCode,200); assert.equal(mined,1);
  chain='0x1'; assert.equal((await app.inject({method:'POST',url:'/blockchain/demo-block'})).statusCode,409); assert.equal(mined,1);
});
