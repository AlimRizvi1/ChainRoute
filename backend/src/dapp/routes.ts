import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Contract, FetchRequest, Interface, JsonRpcProvider, getAddress, keccak256, toUtf8Bytes, verifyMessage } from "ethers";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { canonicalJson, getStateName } from "../contracts/chain.js";

type Build = { abi: ConstructorParameters<typeof Interface>[0]; bytecode: string; deployedBytecode: string; immutableReferences: Record<string, Array<{ start: number; length: number }>>; compilerVersion: string; sourceName: string; standardInput: unknown };
type Freight = { freight_id: string; user_id: string; plan_id: string; chain_id: string; settlement_address: string; shipper_address: string; carrier_address: string; terms_hash: string; terms: Record<string, string | number>; transaction_data: string; transaction_hash: string | null; contract_id: string | null; token_id: string | null; state: string; block_number: string | null; block_timestamp: Date | null; fee_wei: string | null };
class DappError extends Error { constructor(public statusCode: number, public code: string, message: string) { super(message); } }
const address = { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" };
const txHash = { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" };
const bodySchema = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ body: { type: "object", additionalProperties: false, properties, required } });
const uuidParams = { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } };
function walletAddress(value: string) {
  try { return getAddress(value); }
  catch { throw new DappError(400, "INVALID_ADDRESS", "Enter a valid Ethereum wallet address with a correct checksum."); }
}

export function dappNetwork() {
  const chainId = Number(process.env.DAPP_CHAIN_ID || 11155111);
  if (chainId !== 11155111 && !(chainId === 31337 && process.env.NODE_ENV !== "production")) throw new Error("DApp supports Sepolia, or local chain 31337 in development only.");
  return { chainId, chainName: chainId === 11155111 ? "Sepolia" : "Local wallet test", explorer: chainId === 11155111 ? "https://sepolia.etherscan.io" : null,
    rpcUrl: process.env.DAPP_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com", browserRpcUrl: chainId === 11155111 ? "https://ethereum-sepolia-rpc.publicnode.com" : "http://localhost:8545",
    confirmations: chainId === 11155111 ? 2 : 1 };
}

export function normalizeRuntime(code: string, references: Build["immutableReferences"]) {
  let hex = code.slice(2).toLowerCase();
  for (const locations of Object.values(references)) for (const { start, length } of locations) hex = hex.slice(0, start * 2) + "0".repeat(length * 2) + hex.slice((start + length) * 2);
  return hex;
}
const loadBuild = async () => JSON.parse(await readFile(process.env.DAPP_BUILD_PATH || resolve(process.cwd(), "../blockchain/deployments/dapp-build.json"), "utf8")) as Build;

export function registerDappRoutes(app: FastifyInstance, db: Pool) {
  const network = dappNetwork();
  const route = (permission: "artifact.read" | "plans.accept" | "admin.users" = "artifact.read") => ({ permission });
  async function withRpc<T>(fn: (provider: JsonRpcProvider, build: Build) => Promise<T>) {
    const rpc = new FetchRequest(network.rpcUrl); rpc.timeout = 12_000;
    const provider = new JsonRpcProvider(rpc);
    try {
      if (Number((await provider.getNetwork()).chainId) !== network.chainId) throw new DappError(503, "CHAIN_MISMATCH", "The DApp RPC is connected to a different network.");
      return await fn(provider, await loadBuild());
    } finally { provider.destroy(); }
  }
  async function linked(request: FastifyRequest) {
    const result = await db.query<{ address: string }>("SELECT address FROM wallet_links WHERE user_id=$1", [request.actor!.userId]);
    if (!result.rows[0]) throw new DappError(409, "WALLET_REQUIRED", "Connect MetaMask and sign the account-link message first.");
    return getAddress(result.rows[0].address);
  }
  async function deployment() {
    const result = await db.query("SELECT * FROM wallet_deployments WHERE chain_id=$1", [network.chainId]);
    if (!result.rows[0]) throw new DappError(409, "DEPLOYMENT_REQUIRED", "An administrator must deploy the freight contract using MetaMask first.");
    return result.rows[0];
  }
  async function visible(request: FastifyRequest, id: string) {
    const result = await db.query<Freight>("SELECT * FROM wallet_freights WHERE freight_id=$1 AND chain_id=$2", [id, network.chainId]);
    const row = result.rows[0];
    if (!row) throw new DappError(404, "NOT_FOUND", "Wallet freight was not found.");
    if (!["Administrator", "Auditor"].includes(request.actor!.role) && row.user_id !== request.actor!.userId) {
      const wallet = await linked(request);
      if (wallet.toLowerCase() !== row.carrier_address.toLowerCase()) throw new DappError(404, "NOT_FOUND", "Wallet freight was not found.");
    }
    return row;
  }
  function safe(handler: (request: any, reply: any) => Promise<unknown>) {
    return async (request: FastifyRequest, reply: any) => {
      try { return await handler(request, reply); }
      catch (error) {
        if (error instanceof DappError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
        if ((error as { code?: string }).code === "CALL_EXCEPTION") return reply.code(409).send({ error: { code: "CONTRACT_REJECTED", message: "The contract rejected this action. Refresh the on-chain state and check the role, deadline, and milestone timestamp before retrying." } });
        if ((error as { code?: string }).code === "23505") return reply.code(409).send({ error: { code: "ALREADY_EXISTS", message: "This wallet, deployment, or plan already has a record. Refresh to continue." } });
        request.log.warn({ err: error }, "Wallet operation failed");
        return reply.code(503).send({ error: { code: "DAPP_UNAVAILABLE", message: "The wallet service or network is unavailable. A submitted transaction is retained; refresh its receipt rather than sending it again." } });
      }
    };
  }
  app.get("/dapp/config", { config: route() }, safe(async (request) => {
    const [wallet, deployed, carriers] = await Promise.all([
      db.query("SELECT address FROM wallet_links WHERE user_id=$1", [request.actor.userId]),
      db.query("SELECT address, operator_address, transaction_hash FROM wallet_deployments WHERE chain_id=$1", [network.chainId]),
      db.query("SELECT u.username, w.address FROM wallet_links w JOIN users u USING(user_id) WHERE u.active AND u.role='Carrier' ORDER BY u.username"),
    ]);
    return { chainId: network.chainId, chainName: network.chainName, explorer: network.explorer, rpcUrl: network.browserRpcUrl,
      confirmations: network.confirmations, linkedAddress: wallet.rows[0]?.address ?? null, deployment: deployed.rows[0] ?? null, carriers: carriers.rows,
      token: { standard: "ERC-721", name: "ChainRoute Freight Receipt", symbol: "CRFR" }, paymentMode: "gas-only" };
  }));
  app.post("/dapp/wallet/challenge", { config: route(), schema: bodySchema({ address }) }, safe(async (request) => {
    const wallet = walletAddress(request.body.address); const id = randomUUID(); const expires = new Date(Date.now() + 300_000);
    const message = `ChainRoute wallet ownership verification\nOrigin: ${process.env.DAPP_ORIGIN || "http://localhost:5173"}\nAccount: ${request.actor.userId}\nWallet: ${wallet}\nChain ID: ${network.chainId}\nNonce: ${id}\nExpires: ${expires.toISOString()}\nThis signature links your wallet. It does not authorize a transaction or payment.`;
    await db.query("DELETE FROM wallet_challenges WHERE expires_at < now()", []);
    await db.query("INSERT INTO wallet_challenges(challenge_id,user_id,address,message,expires_at) VALUES($1,$2,$3,$4,$5)", [id, request.actor.userId, wallet, message, expires]);
    return { challengeId: id, message };
  }));
  app.post("/dapp/wallet/verify", { config: route(), schema: bodySchema({ challengeId: { type: "string", format: "uuid" }, signature: { type: "string", pattern: "^0x[0-9a-fA-F]{130}$" } }) }, safe(async (request) => {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query("SELECT * FROM wallet_challenges WHERE challenge_id=$1 AND user_id=$2 AND consumed_at IS NULL AND expires_at>now() FOR UPDATE", [request.body.challengeId, request.actor.userId]);
      const challenge = result.rows[0];
      if (!challenge) throw new DappError(400, "INVALID_CHALLENGE", "The wallet challenge expired or was already used. Connect again.");
      let recovered = ""; try { recovered = verifyMessage(challenge.message, request.body.signature); } catch { /* reject below */ }
      if (recovered.toLowerCase() !== challenge.address.toLowerCase()) throw new DappError(403, "INVALID_SIGNATURE", "The signature does not belong to the requested wallet.");
      const existing = await client.query("SELECT address FROM wallet_links WHERE user_id=$1", [request.actor.userId]);
      if (existing.rows[0] && existing.rows[0].address.toLowerCase() !== recovered.toLowerCase()) throw new DappError(409, "WALLET_ALREADY_LINKED", "This account already has a verified wallet. Use that wallet; wallet replacement requires an account recovery process.");
      await client.query("INSERT INTO wallet_links(user_id,address) VALUES($1,$2) ON CONFLICT(user_id) DO NOTHING", [request.actor.userId, recovered]);
      await client.query("UPDATE wallet_challenges SET consumed_at=now() WHERE challenge_id=$1", [challenge.challenge_id]);
      await client.query("COMMIT"); return { address: recovered };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }));
  app.get("/dapp/build", { config: route("admin.users") }, safe(async () => {
    const build = await loadBuild(); return { abi: build.abi, bytecode: build.bytecode, compilerVersion: build.compilerVersion, sourceName: build.sourceName, standardInput: build.standardInput };
  }));
  app.post("/dapp/deployments", { config: route("admin.users"), schema: bodySchema({ transactionHash: txHash }) }, safe(async (request, reply) => {
    const wallet = await linked(request);
    return withRpc(async (provider, build) => {
      const receipt = await provider.getTransactionReceipt(request.body.transactionHash);
      if (!receipt) return reply.code(202).send({ status: "pending" });
      if (receipt.status !== 1 || !receipt.contractAddress || receipt.from.toLowerCase() !== wallet.toLowerCase()) throw new DappError(400, "INVALID_DEPLOYMENT", "A successful deployment from your linked wallet is required.");
      if (await receipt.confirmations() < network.confirmations) return reply.code(202).send({ status: "pending" });
      const creation = await provider.getTransaction(receipt.hash);
      if (!creation || creation.to !== null || creation.data.toLowerCase() !== build.bytecode.toLowerCase() || creation.value !== 0n || Number(creation.chainId) !== network.chainId) throw new DappError(400, "INVALID_CONSTRUCTOR", "Deploy the exact ChainRoute build without constructor arguments or an ETH transfer.");
      const code = await provider.getCode(receipt.contractAddress);
      if (normalizeRuntime(code, build.immutableReferences) !== normalizeRuntime(build.deployedBytecode, build.immutableReferences)) throw new DappError(400, "INVALID_BYTECODE", "The deployed code does not match this ChainRoute build.");
      const contract = new Contract(receipt.contractAddress, build.abi, provider);
      if (getAddress(await contract.getFunction("operator")()) !== wallet) throw new DappError(400, "INVALID_OPERATOR", "The deploying wallet must be the contract operator.");
      const previous = await db.query("SELECT address FROM wallet_deployments WHERE chain_id=$1", [network.chainId]);
      if (previous.rows[0] && previous.rows[0].address.toLowerCase() !== receipt.contractAddress.toLowerCase()) throw new DappError(409, "DEPLOYMENT_EXISTS", "This network already has a deployment. Existing records require an explicit migration.");
      await db.query("INSERT INTO wallet_deployments(chain_id,address,operator_address,transaction_hash,deployed_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(chain_id) DO NOTHING", [network.chainId, receipt.contractAddress, wallet, receipt.hash, request.actor.userId]);
      return { status: "confirmed", address: receipt.contractAddress, transactionHash: receipt.hash };
    });
  }));
  app.get("/dapp/freights", { config: route() }, safe(async (request) => {
    const all = ["Administrator", "Auditor"].includes(request.actor.role);
    const result = await db.query(`SELECT f.*, COALESCE((SELECT jsonb_agg(jsonb_build_object('transactionHash',a.transaction_hash,'action',a.action,'status',a.status,'blockNumber',a.block_number,'timestamp',a.block_timestamp,'feeWei',a.fee_wei) ORDER BY a.created_at) FROM wallet_action_transactions a WHERE a.freight_id=f.freight_id),'[]'::jsonb) AS actions FROM wallet_freights f WHERE f.chain_id=$1 AND ($2::boolean OR f.user_id=$3 OR lower(f.carrier_address)=(SELECT lower(address) FROM wallet_links WHERE user_id=$3)) ORDER BY f.created_at DESC LIMIT 100`, [network.chainId, all, request.actor.userId]);
    return { items: result.rows };
  }));
  app.post("/dapp/freights/prepare", { config: route("plans.accept"), schema: bodySchema({ planId: { type: "string", minLength: 1, maxLength: 256 }, carrierAddress: address,
    terms: { type: "object", additionalProperties: false, required: ["freightValuePaise", "penaltyBpsPerBlock", "penaltyBlockSeconds", "freeHoldingHours", "demurrageRatePaisePerWagonHour"], properties: {
      freightValuePaise: { type: "string", pattern: "^[1-9][0-9]{0,25}$" }, penaltyBpsPerBlock: { type: "integer", minimum: 0, maximum: 10000 },
      penaltyBlockSeconds: { type: "integer", minimum: 1, maximum: 4294967295 }, freeHoldingHours: { type: "integer", minimum: 0, maximum: 65535 }, demurrageRatePaisePerWagonHour: { type: "string", pattern: "^[0-9]{1,26}$" },
    } } }) }, safe(async (request) => {
    const wallet = await linked(request); const deployed = await deployment();
    const result = await db.query("SELECT * FROM allocation_plans WHERE plan_id=$1 AND created_by=$2", [request.body.planId, request.actor.userId]);
    const plan = result.rows[0]; if (!plan) throw new DappError(404, "NOT_FOUND", "Use a saved allocation plan created by this account.");
    const existing = await db.query<Freight>("SELECT * FROM wallet_freights WHERE chain_id=$1 AND settlement_address=$2 AND scenario_group_id=$3", [network.chainId, deployed.address, plan.scenario_group_id]);
    if (existing.rows[0]) {
      const saved = existing.rows[0];
      if (saved.plan_id !== request.body.planId || saved.carrier_address.toLowerCase() !== request.body.carrierAddress.toLowerCase() || Object.entries(request.body.terms).some(([key, value]) => saved.terms[key] !== value)) throw new DappError(409, "PREPARED_TERMS_DIFFER", "This scenario already has a prepared freight with different terms. Use its saved receipt or create a new allocation.");
      return { freight: saved, transaction: transactionFor(saved) };
    }
    const local = await db.query("SELECT 1 FROM contracts WHERE scenario_group_id=$1", [plan.scenario_group_id]);
    if (local.rowCount) throw new DappError(409, "ALREADY_CONTRACTED", "This scenario already has a local agreement. Create a new allocation for Sepolia.");
    const assignments = plan.plan_payload.assignments ?? [];
    const wagonCount = assignments.reduce((count: number, item: { wagonIds: string[] }) => count + item.wagonIds.length, 0);
    if (!wagonCount) throw new DappError(400, "PLAN_NOT_BOOKABLE", "This allocation has no assigned wagons.");
    const deadlines = await db.query("SELECT min(o.deadline) AS deadline FROM plan_orders po JOIN orders o USING(order_id) WHERE po.plan_id=$1 AND po.assigned", [plan.plan_id]);
    const deadline = deadlines.rows[0]?.deadline as Date | undefined;
    if (!deadline || deadline.getTime() <= Date.now()) throw new DappError(409, "DEADLINE_EXPIRED", "Create an allocation with a future delivery deadline.");
    const carrier = walletAddress(request.body.carrierAddress);
    if (carrier === wallet || carrier === "0x0000000000000000000000000000000000000000") throw new DappError(400, "INVALID_CARRIER", "Choose a different, non-zero carrier wallet.");
    const terms = { ...request.body.terms, wagonCount, slaDeadline: Math.floor(deadline.getTime() / 1000) };
    const termsHash = keccak256(toUtf8Bytes(canonicalJson({ planId: plan.plan_id, shipper: wallet, carrier, terms, assignments })));
    const build = await loadBuild();
    const data = new Interface(build.abi).encodeFunctionData("initiateFreight", [plan.plan_id, carrier, { ...terms, termsHash }]);
    const saved = await db.query<Freight>(`INSERT INTO wallet_freights(freight_id,user_id,plan_id,scenario_group_id,chain_id,settlement_address,shipper_address,carrier_address,terms_hash,terms,transaction_data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11) RETURNING *`, [randomUUID(), request.actor.userId, plan.plan_id, plan.scenario_group_id, network.chainId, deployed.address, wallet, carrier, termsHash, JSON.stringify(terms), data]);
    return { freight: saved.rows[0], transaction: transactionFor(saved.rows[0]) };
  }));
  function transactionFor(row: Freight) { return { to: row.settlement_address, from: row.shipper_address, data: row.transaction_data, value: "0x0", chainId: network.chainId }; }
  app.post("/dapp/freights/:id/submit", { config: route("plans.accept"), schema: { ...uuidParams, ...bodySchema({ transactionHash: txHash }) } }, safe(async (request) => {
    const row = await visible(request, request.params.id); const wallet = await linked(request);
    if (row.user_id !== request.actor.userId || wallet.toLowerCase() !== row.shipper_address.toLowerCase()) throw new DappError(403, "FORBIDDEN", "Only the linked shipper can submit this freight.");
    if (row.transaction_hash && row.transaction_hash !== request.body.transactionHash) throw new DappError(409, "ALREADY_SUBMITTED", "A transaction is already attached. Refresh its receipt.");
    return withRpc(async (provider) => {
      const tx = await provider.getTransaction(request.body.transactionHash);
      if (!tx) throw new DappError(409, "NOT_PROPAGATED", "The RPC has not seen this transaction yet. Retry saving its hash; do not resend the transaction.");
      if (tx.from.toLowerCase() !== wallet.toLowerCase() || tx.to?.toLowerCase() !== row.settlement_address.toLowerCase() || tx.data.toLowerCase() !== row.transaction_data.toLowerCase() || tx.value !== 0n || Number(tx.chainId) !== network.chainId) throw new DappError(400, "TRANSACTION_MISMATCH", "Transaction sender, network, contract, terms, or value does not match the prepared freight.");
      await db.query("UPDATE wallet_freights SET transaction_hash=$1,state=CASE WHEN contract_id IS NULL THEN 'Submitted' ELSE state END WHERE freight_id=$2", [tx.hash, row.freight_id]);
      return { transactionHash: tx.hash, status: "submitted" };
    });
  }));
  app.post("/dapp/freights/:id/refresh", { config: route(), schema: uuidParams }, safe(async (request, reply) => {
    const row = await visible(request, request.params.id);
    if (!row.transaction_hash) return row;
    return withRpc(async (provider, build) => {
      const receipt = await provider.getTransactionReceipt(row.transaction_hash!);
      if (!receipt) return reply.code(202).send({ ...row, pending: true });
      const block = await provider.getBlock(receipt.blockNumber);
      if (!block || block.hash !== receipt.blockHash) return reply.code(202).send({ ...row, pending: true });
      if (receipt.status !== 1) {
        await db.query("UPDATE wallet_freights SET state='Failed' WHERE freight_id=$1", [row.freight_id]); return { ...row, state: "Failed" };
      }
      if (await receipt.confirmations() < network.confirmations) return reply.code(202).send({ ...row, pending: true });
      const iface = new Interface(build.abi);
      const events = receipt.logs.filter(log => log.address.toLowerCase() === row.settlement_address.toLowerCase()).map(log => { try { return iface.parseLog(log); } catch { return null; } });
      const initiated = events.find(event => event?.name === "FreightInitiated");
      const minted = events.find(event => event?.name === "Transfer" && event.args.from === "0x0000000000000000000000000000000000000000");
      if (!initiated || !minted || initiated.args.shipper.toLowerCase() !== row.shipper_address.toLowerCase() || initiated.args.termsHash !== row.terms_hash || minted.args.to.toLowerCase() !== row.shipper_address.toLowerCase() || minted.args.tokenId !== initiated.args.tokenId || initiated.args.contractId !== initiated.args.tokenId) throw new DappError(400, "INVALID_RECEIPT", "The receipt does not contain the expected freight and token mint events.");
      const contract = new Contract(row.settlement_address, build.abi, provider);
      const [agreement] = await contract.getFunction("getContractStatus")(initiated.args.contractId);
      if (agreement.planId !== row.plan_id || agreement.carrier.toLowerCase() !== row.carrier_address.toLowerCase()) throw new DappError(400, "INVALID_AGREEMENT", "The on-chain agreement does not match this plan.");
      const state = getStateName(agreement.state);
      const saved = await db.query(`UPDATE wallet_freights SET contract_id=$1,token_id=$2,state=$3,block_number=$4,block_hash=$5,block_timestamp=$6,gas_used=$7,fee_wei=$8 WHERE freight_id=$9 RETURNING *`, [String(initiated.args.contractId), String(initiated.args.tokenId), state, receipt.blockNumber, receipt.blockHash, new Date(block.timestamp * 1000), receipt.gasUsed.toString(), (receipt.gasUsed * receipt.gasPrice).toString(), row.freight_id]);
      const owner = await contract.getFunction("ownerOf")(initiated.args.tokenId);
      return { ...saved.rows[0], receiptOwner: owner, confirmations: await receipt.confirmations(), accounting: { penaltyPaise: String(agreement.penaltyPaise), demurragePaise: String(agreement.demurragePaise), netPaymentPaise: String(agreement.netPaymentPaise) } };
    });
  }));
  app.post("/dapp/freights/:id/action-receipt", { config: route(), schema: { ...uuidParams, ...bodySchema({ transactionHash: txHash }) } }, safe(async (request, reply) => {
    const row = await visible(request, request.params.id); const wallet = await linked(request);
    return withRpc(async (provider, build) => {
      const tx = await provider.getTransaction(request.body.transactionHash);
      if (!tx) return reply.code(202).send({ status: "pending" });
      if (tx.from.toLowerCase() !== wallet.toLowerCase() || tx.to?.toLowerCase() !== row.settlement_address.toLowerCase() || tx.value !== 0n || Number(tx.chainId) !== network.chainId) throw new DappError(400, "TRANSACTION_MISMATCH", "This transaction does not belong to your wallet freight.");
      const parsed = new Interface(build.abi).parseTransaction({ data: tx.data });
      if (!parsed || !["confirmBooking", "updateShipmentStatus", "confirmDelivery", "raiseDispute", "resolveDispute", "releasePayment", "closeContract"].includes(parsed.name) || String(parsed.args[0]) !== row.contract_id) throw new DappError(400, "INVALID_ACTION", "This transaction is not a lifecycle action for this freight.");
      await db.query("INSERT INTO wallet_action_transactions(chain_id,transaction_hash,freight_id,user_id,action,status) VALUES($1,$2,$3,$4,$5,'pending') ON CONFLICT DO NOTHING", [network.chainId, tx.hash, row.freight_id, request.actor.userId, parsed.name]);
      const receipt = await provider.getTransactionReceipt(tx.hash);
      if (!receipt || await receipt.confirmations() < network.confirmations) return reply.code(202).send({ status: "pending" });
      const block = await provider.getBlock(receipt.blockNumber);
      if (!block || block.hash !== receipt.blockHash) return reply.code(202).send({ status: "pending" });
      const status = receipt.status === 1 ? "confirmed" : "failed";
      await db.query("UPDATE wallet_action_transactions SET status=$1,block_number=$2,block_timestamp=$3,fee_wei=$4 WHERE chain_id=$5 AND transaction_hash=$6", [status, receipt.blockNumber, new Date(block.timestamp * 1000), (receipt.gasUsed * receipt.gasPrice).toString(), network.chainId, receipt.hash]);
      return { status, transactionHash: receipt.hash, blockNumber: receipt.blockNumber };
    });
  }));
  app.post("/dapp/freights/:id/action", { config: route(), schema: { ...uuidParams, ...bodySchema({ action: { type: "string", enum: ["confirmBooking", "updateShipmentStatus", "confirmDelivery", "raiseDispute", "resolveDispute", "releasePayment", "closeContract"] }, status: { type: "integer", minimum: 0, maximum: 2 }, timestamp: { type: "integer", minimum: 0 }, podReference: { type: "string", minLength: 1, maxLength: 256 }, reasonCode: { type: "string", minLength: 1, maxLength: 128 }, outcome: { type: "integer", minimum: 0, maximum: 2 } }, ["action"]) } }, safe(async (request) => {
    const row = await visible(request, request.params.id); const wallet = await linked(request);
    if (!row.contract_id) throw new DappError(409, "NOT_CONFIRMED", "Confirm freight initiation before taking an action.");
    return withRpc(async (provider, build) => {
      const contract = new Contract(row.settlement_address, build.abi, provider);
      const action = request.body.action as string;
      const admin = ["resolveDispute", "releasePayment", "closeContract"].includes(action);
      const party = action === "raiseDispute";
      const allowed = admin ? request.actor.role === "Administrator" && (await contract.getFunction("operator")()).toLowerCase() === wallet.toLowerCase()
        : party ? ["Shipper", "Carrier"].includes(request.actor.role) && [row.shipper_address, row.carrier_address].some(a => a.toLowerCase() === wallet.toLowerCase())
        : request.actor.role === "Carrier" && wallet.toLowerCase() === row.carrier_address.toLowerCase();
      if (!allowed) throw new DappError(403, "FORBIDDEN", "Your role and connected wallet cannot perform this contract action.");
      const b = request.body;
      let args: unknown[] = [row.contract_id];
      if (action === "updateShipmentStatus") {
        if (b.status === undefined || b.timestamp === undefined) throw new DappError(400, "MISSING_FIELDS", "Shipment status and timestamp are required.");
        args.push(b.status, b.timestamp);
      } else if (action === "confirmDelivery") {
        if (b.timestamp === undefined || !b.podReference) throw new DappError(400, "MISSING_FIELDS", "Delivery time and proof reference are required.");
        args.push(b.timestamp, b.podReference);
      } else if (action === "raiseDispute") {
        if (!b.reasonCode) throw new DappError(400, "MISSING_FIELDS", "A dispute reason is required."); args.push(b.reasonCode, wallet);
      } else if (action === "resolveDispute") {
        if (b.outcome === undefined) throw new DappError(400, "MISSING_FIELDS", "Choose a dispute outcome."); args.push(b.outcome);
      }
      // Simulate using the actual sender; contract state and role restrictions remain authoritative.
      const data = contract.interface.encodeFunctionData(action, args);
      await provider.call({ from: wallet, to: row.settlement_address, data });
      return { from: wallet, to: row.settlement_address, data, value: "0x0", chainId: network.chainId };
    });
  }));
}
