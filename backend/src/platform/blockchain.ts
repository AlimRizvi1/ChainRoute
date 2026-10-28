import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";

// Fixed RPC methods and bounded windows: this route is not an arbitrary RPC proxy.
// Headers and transaction hashes are public chain data; calldata and commercial terms stay in the role-filtered contract API.
export function registerBlockchainExplorer(app: FastifyInstance, rpcUrl: string, artifactPath: string) {
  async function rpc(method: string, params: unknown[] = []): Promise<any> {
    const response = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("Chain unavailable");
    const body = await response.json() as { result?: unknown; error?: unknown };
    if (body.error || body.result === undefined) throw new Error("Chain request failed");
    return body.result;
  }
  app.get<{ Querystring: { limit?: number; before?: number; from?: number } }>("/blockchain/blocks", {
    config: { permission: "artifact.read" }, schema: { querystring: { type: "object", additionalProperties: false, properties: {
      limit: { type: "integer", minimum: 1, maximum: 20, default: 12 }, before: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
      from: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    } } },
  }, async (request, reply) => {
    if (request.query.from !== undefined && request.query.before !== undefined)
      return reply.code(400).send({ error: { code: "INVALID_WINDOW", message: "Choose either a starting block or an earlier window." } });
    try {
      const [headHex, chainHex, clientVersion, artifact] = await Promise.all([
        rpc("eth_blockNumber"), rpc("eth_chainId"), rpc("web3_clientVersion"),
        readFile(artifactPath, "utf8").then(JSON.parse).catch(() => null),
      ]);
      const head = Number(BigInt(headHex)), chainId = Number(BigInt(chainHex));
      const limit = request.query.limit ?? 12;
      const end = request.query.from === undefined ? Math.min(request.query.before ?? head, head) : Math.min(head, request.query.from + limit - 1);
      const start = request.query.from === undefined ? Math.max(0, end - limit + 1) : Math.min(head, request.query.from);
      const [blocks, genesis] = await Promise.all([
        Promise.all(Array.from({ length: end - start + 1 }, (_, i) => rpc("eth_getBlockByNumber", [`0x${(start + i).toString(16)}`, false]))),
        rpc("eth_getBlockByNumber", ["0x0", false]),
      ]);
      if (!genesis || blocks.some(block => !block)) throw new Error("Incomplete block window");
      const serialize = (block: any) => ({ number: Number(BigInt(block.number)), hash: block.hash, parentHash: block.parentHash,
        timestamp: new Date(Number(BigInt(block.timestamp)) * 1000).toISOString(),
        stateRoot: block.stateRoot, transactionsRoot: block.transactionsRoot, receiptsRoot: block.receiptsRoot,
        gasUsed: BigInt(block.gasUsed).toString(), gasLimit: BigInt(block.gasLimit).toString(),
        baseFeePerGas: block.baseFeePerGas ? BigInt(block.baseFeePerGas).toString() : null,
        size: Number(BigInt(block.size)), miner: block.miner, nonce: block.nonce, transactions: block.transactions,
      });
      return { chainId, head, clientVersion, observedAt: new Date().toISOString(),
        localDevelopment: chainId === 31337, canMine: chainId === 31337 && process.env.NODE_ENV !== "production" && request.actor!.role === "Administrator",
        contractAddress: artifact?.chainId === chainId ? artifact.address : null,
        nextBefore: start > 0 ? start - 1 : null,
        nextFrom: end < head ? end + 1 : null,
        genesis: serialize(genesis),
        blocks: blocks.map(serialize),
      };
    } catch { return reply.code(503).send({ error: { code: "CHAIN_UNAVAILABLE", message: "The blockchain node is unavailable. Start it, then refresh the ledger." } }); }
  });
  app.post("/blockchain/demo-block", {
    config: { permission: "admin.users", auditAction: "blockchain.demoBlock", auditResourceType: "block", rateLimit: { max: 12, timeWindow: "1 minute" } },
  }, async (_request, reply) => {
    try {
      if (process.env.NODE_ENV === "production" || BigInt(await rpc("eth_chainId")) !== 31337n)
        return reply.code(409).send({ error: { code: "LOCAL_CHAIN_ONLY", message: "Demonstration blocks are available only on the local development chain." } });
      await rpc("evm_mine");
      return { number: Number(BigInt(await rpc("eth_blockNumber"))) };
    } catch { return reply.code(503).send({ error: { code: "CHAIN_UNAVAILABLE", message: "The demonstration block could not be mined. Refresh the ledger before retrying." } }); }
  });
}
