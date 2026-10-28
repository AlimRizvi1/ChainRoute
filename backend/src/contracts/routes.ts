import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";
import { Contract, getAddress, keccak256, toUtf8Bytes } from "ethers";
import type { AuthenticatedActor } from "../auth/fastify.js";
import { canonicalJson, findEvent, getSigner, getStateName, openSettlement, submitTransaction } from "./chain.js";

type TermsInput = {
  carrierAddress: string;
  terms: {
    freightValuePaise: string;
    penaltyBpsPerBlock: number;
    penaltyBlockSeconds: number;
    freeHoldingHours: number;
    demurrageRatePaisePerWagonHour: string;
    wagonCount: number;
  };
};
type ContractRow = {
  contract_id: string;
  plan_id: string;
  shipper_id: string;
  carrier_id: string;
  shipper_address: string;
  carrier_address: string;
  terms: Record<string, unknown>;
  assignments: unknown[];
  state: string;
  agreement_hash: string | null;
  terms_hash: string;
  freight_value_paise: string;
  sla_deadline: Date;
  penalty_paise: string;
  demurrage_paise: string;
  net_payment_paise: string | null;
  sync_status: string;
  transaction_hash?: string | null;
};

const idempotencyHeader = {
  type: "object", required: ["idempotency-key"], additionalProperties: true,
  properties: { "idempotency-key": { type: "string", minLength: 1, maxLength: 128 } },
};
const contractIdParams = { type: "object", required: ["contractId"], properties: { contractId: { type: "string", pattern: "^[1-9][0-9]*$" } } };
const acceptSchema = {
  headers: idempotencyHeader,
  body: { type: "object", additionalProperties: false, required: ["carrierAddress", "terms"], properties: {
    carrierAddress: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
    terms: { type: "object", additionalProperties: false, required: ["freightValuePaise", "penaltyBpsPerBlock", "penaltyBlockSeconds", "freeHoldingHours", "demurrageRatePaisePerWagonHour", "wagonCount"], properties: {
      freightValuePaise: { type: "string", pattern: "^[1-9][0-9]*$" },
      penaltyBpsPerBlock: { type: "integer", minimum: 0, maximum: 65535 },
      penaltyBlockSeconds: { type: "integer", minimum: 1, maximum: 4294967295 },
      freeHoldingHours: { type: "integer", minimum: 0, maximum: 65535 },
      demurrageRatePaisePerWagonHour: { type: "string", pattern: "^[0-9]+$" },
      wagonCount: { type: "integer", minimum: 0, maximum: 4294967295 },
    } },
  } },
};
const shipmentSchema = { headers: idempotencyHeader, params: contractIdParams, body: { type: "object", additionalProperties: false, required: ["status", "timestamp"], properties: {
  status: { type: "string", enum: ["Dispatched", "CheckpointReached", "ArrivedAtDestination"] }, timestamp: { type: "string", format: "date-time" },
} } };
const deliverySchema = { headers: idempotencyHeader, params: contractIdParams, body: { type: "object", additionalProperties: false, required: ["timestamp", "podReference"], properties: {
  timestamp: { type: "string", format: "date-time" }, podReference: { type: "string", minLength: 1, maxLength: 256 },
} } };

export async function registerContractRoutes(
  app: FastifyInstance,
  database: Pool,
  chainRpcUrl: string,
  contractPath: string,
): Promise<void> {
  app.post<{ Params: { planId: string }; Body: TermsInput }>(
    "/plans/:planId/accept",
    { config: { permission: "plans.accept", auditAction: "plans.accept", auditResourceType: "contract" }, schema: { ...acceptSchema, params: { type: "object", required: ["planId"], properties: { planId: { type: "string", minLength: 1 } } } } },
    async (request, reply) => acceptPlan(request, reply, database, chainRpcUrl, contractPath),
  );

  app.get<{ Querystring: { state?: string; limit?: number; cursor?: string } }>(
    "/contracts",
    { config: { permission: "contracts.read" }, schema: { querystring: { type: "object", additionalProperties: false, properties: {
      state: { type: "string", enum: ["Created", "Booked", "InTransit", "Delivered", "PenaltyCalculated", "PaymentReleased", "Closed", "Disputed"] },
      limit: { type: "integer", minimum: 1, maximum: 100, default: 25 }, cursor: { type: "string" },
    } } } },
    async (request, reply) => {
      const actor = request.actor!;
      const limit = request.query.limit ?? 25;
      const cursor = parseCursor(request.query.cursor);
      const filters: unknown[] = [];
      let where = "";
      if (actor.role === "Shipper") { filters.push(actor.userId); where = "WHERE c.shipper_id = $1"; }
      else if (actor.role === "Carrier") { filters.push(actor.userId); where = "WHERE c.carrier_id = $1"; }
      if (request.query.state) {
        filters.push(request.query.state);
        where += `${where ? " AND" : "WHERE"} c.state = $${filters.length}`;
      }
      if (cursor) {
        filters.push(cursor.createdAt, cursor.contractId);
        where += `${where ? " AND" : "WHERE"} (c.created_at, c.contract_id) < ($${filters.length - 1}::timestamptz, $${filters.length}::text)`;
      }
      filters.push(limit + 1);
      const result = await database.query<ContractRow & { created_at: Date }>(
        `SELECT c.contract_id, c.plan_id, c.shipper_id, c.carrier_id, c.shipper_address, c.carrier_address,
                c.terms, c.assignments, c.state, c.freight_value_paise::text, c.sla_deadline, c.penalty_paise::text,
                c.demurrage_paise::text, c.net_payment_paise::text, c.sync_status, c.created_at
         FROM contracts c ${where} ORDER BY c.created_at DESC, c.contract_id DESC LIMIT $${filters.length}`,
        filters,
      );
      const hasMore = result.rows.length > limit;
      const rows = result.rows.slice(0, limit);
      const last = rows.at(-1);
      return reply.code(200).send({
        items: rows.map((row) => contractSummary(row, actor.userId === row.shipper_id || actor.userId === row.carrier_id)),
        ...(hasMore && last ? { nextCursor: makeCursor(last.created_at, last.contract_id) } : { nextCursor: null }),
      });
    },
  );

  app.get<{ Params: { contractId: string } }>(
    "/contracts/:contractId",
    { config: { permission: "contracts.read" }, schema: { params: contractIdParams } },
    async (request, reply) => {
      const row = await getVisibleContract(database, request.params.contractId, request.actor!);
      if (!row) return apiError(reply, 404, "NOT_FOUND", "Contract was not found.");
      const actor = request.actor!;
      const isParty = actor.userId === row.shipper_id || actor.userId === row.carrier_id;
      const historyResult = await database.query<{ action: string; actor_address: string; occurred_at: Date; data_hash: string; payload: Record<string, unknown> }>(
        "SELECT action, actor_address, occurred_at, data_hash, payload FROM contract_events WHERE contract_id = $1 ORDER BY block_number, log_index, contract_event_id",
        [row.contract_id],
      );
      const history = historyResult.rows.map((event) => ({
        action: event.action, actor: event.actor_address, timestamp: event.occurred_at.toISOString(), dataHash: event.data_hash,
        ...(isParty ? { details: event.payload } : publicMilestoneDetails(event.action, event.payload) ? { details: publicMilestoneDetails(event.action, event.payload) } : {}),
      }));
      if (!isParty) return reply.code(200).send({
        contractId: row.contract_id, planId: row.plan_id, state: row.state,
        shipperId: row.shipper_id, carrierId: row.carrier_id, history,
      });
      return reply.code(200).send({
        contractId: row.contract_id, planId: row.plan_id, state: row.state, shipperId: row.shipper_id,
        carrierId: row.carrier_id, terms: row.terms, termsHash: row.terms_hash, assignments: row.assignments,
        penaltyPaise: row.penalty_paise, demurragePaise: row.demurrage_paise,
        netPaymentPaise: row.net_payment_paise ?? row.freight_value_paise,
        history,
      });
    },
  );

  app.post<{ Params: { contractId: string } }>(
    "/contracts/:contractId/confirm-booking",
    { config: { permission: "contracts.book", auditAction: "contracts.confirm_booking", auditResourceType: "contract" }, schema: { headers: idempotencyHeader, params: contractIdParams } },
    async (request, reply) => runContractAction(request, reply, database, chainRpcUrl, contractPath, "confirm_booking", {}, async (ctx) => {
      ensureRole(ctx.actor, "Carrier"); ensureParty(ctx.row, ctx.actor, "carrier");
      await ctx.call("confirmBooking", [BigInt(ctx.row.contract_id)], ctx.row.carrier_address, "carrier");
      return { contractId: ctx.row.contract_id, state: "Booked" };
    }),
  );

  app.post<{ Params: { contractId: string }; Body: { status: string; timestamp: string } }>(
    "/contracts/:contractId/shipment-status",
    { config: { permission: "contracts.shipment", auditAction: "contracts.shipment_status", auditResourceType: "contract" }, schema: shipmentSchema },
    async (request, reply) => runContractAction(request, reply, database, chainRpcUrl, contractPath, "shipment_status", request.body, async (ctx) => {
      ensureRole(ctx.actor, "Carrier"); ensureParty(ctx.row, ctx.actor, "carrier");
      const statusIndex = ["Dispatched", "CheckpointReached", "ArrivedAtDestination"].indexOf(request.body.status);
      const timestamp = unixSeconds(request.body.timestamp);
      await ctx.call("updateShipmentStatus", [BigInt(ctx.row.contract_id), statusIndex, timestamp], ctx.row.carrier_address, "carrier");
      return { contractId: ctx.row.contract_id, state: ctx.row.state === "Booked" ? "InTransit" : ctx.row.state };
    }),
  );

  app.post<{ Params: { contractId: string }; Body: { timestamp: string; podReference: string } }>(
    "/contracts/:contractId/confirm-delivery",
    { config: { permission: "contracts.delivery", auditAction: "contracts.confirm_delivery", auditResourceType: "contract" }, schema: deliverySchema },
    async (request, reply) => runContractAction(request, reply, database, chainRpcUrl, contractPath, "confirm_delivery", request.body, async (ctx) => {
      ensureRole(ctx.actor, "Carrier"); ensureParty(ctx.row, ctx.actor, "carrier");
      const timestamp = unixSeconds(request.body.timestamp);
      await ctx.call("confirmDelivery", [BigInt(ctx.row.contract_id), timestamp, request.body.podReference], ctx.row.carrier_address, "carrier");
      const status = await ctx.contract.getFunction("getContractStatus")(BigInt(ctx.row.contract_id));
      const agreement = status[0];
      const freight = BigInt(ctx.row.freight_value_paise);
      const penalty = BigInt(agreement.penaltyPaise);
      const demurrage = BigInt(agreement.demurragePaise);
      return { contractId: ctx.row.contract_id, state: "PenaltyCalculated", onTime: agreement.onTime,
        secondsLate: Number(agreement.secondsLate), penaltyPaise: penalty.toString(), demurragePaise: demurrage.toString(),
        netPaymentPaise: (freight - penalty - demurrage).toString() };
    }),
  );

  app.post<{ Params: { contractId: string }; Body: { reasonCode: string } }>(
    "/contracts/:contractId/dispute",
    { config: { permission: "contracts.raiseDispute", auditAction: "contracts.raise_dispute", auditResourceType: "contract" }, schema: { headers: idempotencyHeader, params: contractIdParams, body: { type: "object", additionalProperties: false, required: ["reasonCode"], properties: { reasonCode: { type: "string", minLength: 1, maxLength: 128 } } } } },
    async (request, reply) => runContractAction(request, reply, database, chainRpcUrl, contractPath, "raise_dispute", request.body, async (ctx) => {
      if (!["Shipper", "Carrier"].includes(ctx.actor.role)) throw new ActionError(403, "FORBIDDEN", "Only a contract party can raise a dispute.");
      const party = ctx.actor.userId === ctx.row.shipper_id ? "shipper" : "carrier";
      if (party === "carrier") ensureParty(ctx.row, ctx.actor, "carrier");
      const address = party === "shipper" ? ctx.row.shipper_address : ctx.row.carrier_address;
      await ctx.call("raiseDispute", [BigInt(ctx.row.contract_id), request.body.reasonCode, address], address, party);
      return { contractId: ctx.row.contract_id, state: "Disputed" };
    }),
  );

  app.post<{ Params: { contractId: string }; Body: { outcome: string } }>(
    "/contracts/:contractId/resolve-dispute",
    { config: { permission: "contracts.resolveDispute", auditAction: "contracts.resolve_dispute", auditResourceType: "contract" }, schema: { headers: idempotencyHeader, params: contractIdParams, body: { type: "object", additionalProperties: false, required: ["outcome"], properties: { outcome: { type: "string", enum: ["UpholdDeductions", "WaivePenalty", "WaiveAll"] } } } } },
    async (request, reply) => runContractAction(request, reply, database, chainRpcUrl, contractPath, "resolve_dispute", request.body, async (ctx) => {
      ensureRole(ctx.actor, "Administrator");
      const outcome = ["UpholdDeductions", "WaivePenalty", "WaiveAll"].indexOf(request.body.outcome);
      await ctx.call("resolveDispute", [BigInt(ctx.row.contract_id), outcome], await ctx.operatorAddress(), "operator");
      const status = await ctx.contract.getFunction("getContractStatus")(BigInt(ctx.row.contract_id));
      const agreement = status[0];
      const penaltyPaise = agreement.penaltyPaise.toString();
      const demurragePaise = agreement.demurragePaise.toString();
      return { contractId: ctx.row.contract_id, state: "PenaltyCalculated", penaltyPaise, demurragePaise,
        netPaymentPaise: (BigInt(ctx.row.freight_value_paise) - BigInt(penaltyPaise) - BigInt(demurragePaise)).toString() };
    }),
  );

  app.post<{ Params: { contractId: string } }>(
    "/contracts/:contractId/release-payment",
    { config: { permission: "contracts.resolveDispute", auditAction: "contracts.release_payment", auditResourceType: "contract" }, schema: { headers: idempotencyHeader, params: contractIdParams } },
    async (request, reply) => runContractAction(request, reply, database, chainRpcUrl, contractPath, "release_payment", {}, async (ctx) => {
      ensureRole(ctx.actor, "Administrator");
      const { transactionHash } = await ctx.call("releasePayment", [BigInt(ctx.row.contract_id)], await ctx.operatorAddress(), "operator");
      const status = await ctx.contract.getFunction("getContractStatus")(BigInt(ctx.row.contract_id));
      const agreement = status[0];
      const gross = BigInt(ctx.row.freight_value_paise);
      const penalty = BigInt(agreement.penaltyPaise);
      const demurrage = BigInt(agreement.demurragePaise);
      await ctx.client.query("UPDATE payments SET transaction_hash = $1, released_at = now() WHERE contract_id = $2", [transactionHash, ctx.row.contract_id]);
      await ctx.client.query("UPDATE contracts SET state = 'PaymentReleased', penalty_paise = $1, demurrage_paise = $2, net_payment_paise = $3, sync_status = 'synced', updated_at = now() WHERE contract_id = $4",
        [penalty.toString(), demurrage.toString(), (gross - penalty - demurrage).toString(), ctx.row.contract_id]);
      return { contractId: ctx.row.contract_id, state: "PaymentReleased", netPaymentPaise: (gross - penalty - demurrage).toString(), transactionHash };
    }),
  );

  app.post<{ Params: { contractId: string } }>(
    "/contracts/:contractId/close",
    { config: { permission: "contracts.resolveDispute", auditAction: "contracts.close", auditResourceType: "contract" }, schema: { headers: idempotencyHeader, params: contractIdParams } },
    async (request, reply) => runContractAction(request, reply, database, chainRpcUrl, contractPath, "close", {}, async (ctx) => {
      ensureRole(ctx.actor, "Administrator");
      const { transactionHash } = await ctx.call("closeContract", [BigInt(ctx.row.contract_id)], await ctx.operatorAddress(), "operator");
      await ctx.client.query("UPDATE payments SET closed_at = now() WHERE contract_id = $1", [ctx.row.contract_id]);
      await ctx.client.query("UPDATE contracts SET state = 'Closed', sync_status = 'synced', updated_at = now() WHERE contract_id = $1", [ctx.row.contract_id]);
      return { contractId: ctx.row.contract_id, state: "Closed", transactionHash };
    }),
  );
}

function publicMilestoneDetails(action: string, payload: Record<string, unknown>) {
  if (action === "ShipmentStatusUpdated") return { status: payload.status, timestamp: payload.timestamp };
  if (action === "DeliveryConfirmed") return { timestamp: payload.timestamp };
  return undefined;
}

async function acceptPlan(request: FastifyRequest<{ Params: { planId: string }; Body: TermsInput }>, reply: FastifyReply, db: Pool, rpcUrl: string, artifactPath: string) {
  const actor = request.actor!;
  let queuedOperationId: string | undefined;
  const planResult = actor.role === "Administrator"
    ? await db.query("SELECT plan_payload, created_by, scenario_group_id FROM allocation_plans WHERE plan_id = $1", [request.params.planId])
    : await db.query("SELECT plan_payload, created_by, scenario_group_id FROM allocation_plans WHERE plan_id = $1 AND created_by = $2", [request.params.planId, actor.userId]);
  const planRow = planResult.rows[0];
  if (!planRow) return apiError(reply, 404, "NOT_FOUND", "Plan was not found.");
  const walletFreight = await db.query("SELECT 1 FROM wallet_freights WHERE scenario_group_id=$1 AND state <> 'Failed' LIMIT 1", [planRow.scenario_group_id]);
  if (walletFreight.rowCount) return apiError(reply, 409, "WALLET_FREIGHT_EXISTS", "This scenario has a wallet freight. Continue in Wallet & freight to avoid a duplicate local agreement.");
  let opened: Awaited<ReturnType<typeof openSettlement>> | undefined;
  try {
    const plan = planRow.plan_payload as { assignments?: Array<{ orderId: string; wagonIds?: string[] }> };
    const assigned = plan.assignments ?? [];
    const wagonCount = assigned.reduce((count, assignment) => count + (assignment.wagonIds?.length ?? 0), 0);
    if (!assigned.length || wagonCount < 1) return apiError(reply, 400, "PLAN_NOT_BOOKABLE", "The plan has no assigned wagons to contract.");
    const deadlines = await db.query<{ deadline: Date }>("SELECT min(o.deadline) AS deadline FROM plan_orders po JOIN orders o ON o.order_id = po.order_id WHERE po.plan_id = $1 AND po.assigned = true", [request.params.planId]);
    const deadline = deadlines.rows[0]?.deadline;
    if (!deadline || deadline.getTime() <= Date.now()) return apiError(reply, 409, "PLAN_DEADLINE_EXPIRED", "The plan deadline has passed.");
    if (request.body.terms.wagonCount !== wagonCount) {
      return apiError(reply, 400, "INVALID_TERMS", "wagonCount is derived from assigned plan wagons.");
    }
    const shipperResult = await db.query<{ user_id: string; chain_address: string | null }>("SELECT user_id, chain_address FROM users WHERE user_id = $1 AND active = true", [planRow.created_by]);
    const shipper = shipperResult.rows[0];
    let carrierAddress: string;
    try { carrierAddress = getAddress(request.body.carrierAddress); }
    catch { return apiError(reply, 400, "INVALID_PARTY", "carrierAddress must be a valid hexadecimal address."); }
    const carrierResult = await db.query<{ user_id: string; chain_address: string | null }>("SELECT user_id, chain_address FROM users WHERE chain_address = $1 AND role = 'Carrier' AND active = true", [carrierAddress]);
    const carrier = carrierResult.rows[0];
    if (!shipper?.chain_address || !carrier?.chain_address) return apiError(reply, 400, "INVALID_PARTY", "The plan owner and carrier must have active on-chain account mappings.");
    const normalizedTerms = {
      freightValuePaise: request.body.terms.freightValuePaise,
      slaDeadline: deadline.toISOString(),
      penaltyBpsPerBlock: request.body.terms.penaltyBpsPerBlock,
      penaltyBlockSeconds: request.body.terms.penaltyBlockSeconds,
      freeHoldingHours: request.body.terms.freeHoldingHours,
      demurrageRatePaisePerWagonHour: request.body.terms.demurrageRatePaisePerWagonHour,
      wagonCount,
    };
    const termsDocument = { planId: request.params.planId, shipper: shipper.chain_address, carrier: carrier.chain_address, terms: normalizedTerms };
    const termsHash = keccak256(toUtf8Bytes(canonicalJson(termsDocument)));
    const idempotencyKey = getIdempotencyKey(request);
    const requestHash = hashRequest({ ...termsDocument, idempotencyKey });
    let operation: Awaited<ReturnType<typeof reserveOperation>>;
    try {
      operation = await reserveOperation(db, {
        planId: request.params.planId, contractId: null, action: "accept", idempotencyKey, requestHash,
        requestPayload: request.body, actorUserId: actor.userId,
        workerToken: request.headers["x-chainroute-worker-token"] as string | undefined,
        scenarioGroupId: planRow.scenario_group_id,
      });
    } catch (error) {
      if ((error as { code?: string })?.code === "23505") {
        return apiError(reply, 409, "SCENARIO_ACCEPTANCE_PENDING", "Another plan from this what-if set is already being accepted.");
      }
      throw error;
    }
    if (operation.kind === "replay") return reply.code(200).send(operation.payload);
    if (operation.kind === "queued") return queuedReply(reply, operation.operationId);
    queuedOperationId = operation.operationId;
    const existing = await db.query("SELECT contract_id FROM contracts WHERE scenario_group_id = $1", [planRow.scenario_group_id]);
    if (existing.rowCount) {
      await markOperationFailed(db, request.params.planId, "accept", idempotencyKey, new ActionError(409, "SCENARIO_ALREADY_ACCEPTED", "A plan from this what-if set already has a contract."));
      return apiError(reply, 409, "SCENARIO_ALREADY_ACCEPTED", "A plan from this what-if set already has a contract.");
    }
    opened = await openSettlement(rpcUrl, artifactPath);
    const operator = getAddress(await opened.contract.getFunction("operator")());
    let event = await findAcceptedEvent(opened.contract, request.params.planId);
    let transactionHash: string | null = null;
    if (operation.kind === "in_progress" && !event) {
      return apiError(reply, 409, "OPERATION_IN_PROGRESS", "This idempotent operation is still being reconciled.");
    }
    if (event) {
      transactionHash = event.transactionHash ?? null;
      const status = await opened.contract.getFunction("getContractStatus")(BigInt(event.args.contractId));
      const agreement = status[0];
      if (String(agreement.planId) !== request.params.planId ||
          String(agreement.shipper).toLowerCase() !== shipper.chain_address.toLowerCase() ||
          String(agreement.carrier).toLowerCase() !== carrier.chain_address.toLowerCase() ||
          String(agreement.terms.termsHash).toLowerCase() !== termsHash.toLowerCase()) {
        return apiError(reply, 409, "PLAN_ALREADY_ACCEPTED", "This plan already has a different on-chain agreement.");
      }
    } else {
      const operatorSigner = await getSigner(opened.provider, operator, "operator");
      const signedContract = opened.contract.connect(operatorSigner) as Contract;
      const transaction = await signedContract.getFunction("createAgreement")(
        request.params.planId, shipper.chain_address, carrier.chain_address,
        { ...normalizedTerms, slaDeadline: Math.floor(deadline.getTime() / 1000), termsHash },
      );
      const receipt = await transaction.wait();
      if (!receipt || receipt.status !== 1) throw new Error("Agreement creation was not confirmed.");
      event = findEvent(opened.contract, receipt, "AgreementCreated");
      transactionHash = receipt.hash;
    }
    if (!event || String(event.args.planId) !== request.params.planId) throw new Error("AgreementCreated event is missing or invalid.");
    const contractId = BigInt(event.args.contractId).toString();
    const agreementHash = String(event.args.agreementHash);
    const response = { contractId, planId: request.params.planId, state: "Created", agreementHash };
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO contracts (contract_id, plan_id, scenario_group_id, shipper_id, carrier_id, shipper_address, carrier_address, state,
          agreement_hash, terms_hash, terms, assignments, freight_value_paise, sla_deadline, sync_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'Created', $8, $9, $10::jsonb, $11::jsonb, $12, $13, 'synced')`,
        [contractId, request.params.planId, planRow.scenario_group_id, shipper.user_id, carrier.user_id, shipper.chain_address, carrier.chain_address,
          agreementHash, termsHash, JSON.stringify(normalizedTerms), JSON.stringify(assigned), normalizedTerms.freightValuePaise, deadline],
      );
      await client.query(
        `INSERT INTO payments (contract_id, gross_paise, penalty_paise, demurrage_paise, net_paise)
         VALUES ($1, $2, 0, 0, $2)`,
        [contractId, normalizedTerms.freightValuePaise],
      );
      await completeOperation(client, operation.operationId, request.params.planId, "accept", idempotencyKey, response, transactionHash, contractId);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
    return reply.code(200).send(response);
  } catch (error) {
    if (queuedOperationId && isChainUnavailable(error)) {
      await queueOperation(db, queuedOperationId, error);
      return queuedReply(reply, queuedOperationId);
    }
    await markOperationFailed(db, request.params.planId, "accept", request.headers["idempotency-key"] as string | undefined, error);
    if (error instanceof ActionError) return apiError(reply, error.status, error.code, error.message);
    return chainError(reply, error);
  } finally { await opened?.provider.destroy(); }
}

type OperationContext = {
  actor: AuthenticatedActor;
  row: ContractRow;
  contract: Contract;
  client: PoolClient;
  operatorAddress: () => Promise<string>;
  call: (method: string, args: unknown[], signerAddress: string, role: "operator" | "shipper" | "carrier") => Promise<{ transactionHash: string }>;
};
type ContractAction = (context: OperationContext) => Promise<Record<string, unknown>>;

async function runContractAction(
  request: FastifyRequest<{ Params: { contractId: string }; Body?: unknown }>,
  reply: FastifyReply,
  db: Pool,
  rpcUrl: string,
  artifactPath: string,
  action: string,
  body: unknown,
  operation: ContractAction,
) {
  const actor = request.actor!;
  const row = await getVisibleContract(db, request.params.contractId, actor);
  if (!row) return apiError(reply, 404, "NOT_FOUND", "Contract was not found.");
  const idempotencyKey = getIdempotencyKey(request);
  const requestHash = hashRequest(body);
  const reserved = await reserveOperation(db, {
    planId: row.plan_id, contractId: row.contract_id, action, idempotencyKey, requestHash,
    requestPayload: body && typeof body === "object" ? body as Record<string, unknown> : {},
    actorUserId: actor.userId,
    workerToken: request.headers["x-chainroute-worker-token"] as string | undefined,
  });
  if (reserved.kind === "replay") return reply.code(200).send(reserved.payload);
  if (reserved.kind === "queued") return queuedReply(reply, reserved.operationId);
  let opened: Awaited<ReturnType<typeof openSettlement>> | undefined;
  let client: PoolClient | undefined;
  try {
    opened = await openSettlement(rpcUrl, artifactPath);
    const chainStatus = await opened.contract.getFunction("getContractStatus")(BigInt(row.contract_id));
    const chainAgreement = chainStatus[0];
    if (reserved.kind === "in_progress") {
      if (await alreadyApplied(action, chainAgreement, body, opened.contract, BigInt(row.contract_id))) {
        const response = await reconcileResponse(action, row, chainAgreement, opened.contract, BigInt(row.contract_id));
        client = await db.connect();
        await synchronizeContractRow(client, row, action, response);
        await completeOperation(db, reserved.operationId, row.plan_id, action, idempotencyKey, response, null, row.contract_id);
        return reply.code(200).send(response);
      }
      return apiError(reply, 409, "OPERATION_IN_PROGRESS", "This idempotent operation is still being reconciled.");
    }
    if (getStateName(chainAgreement.state) !== row.state && !["confirm_booking", "shipment_status", "confirm_delivery", "raise_dispute", "resolve_dispute", "release_payment", "close"].includes(action)) {
      return apiError(reply, 409, "CONTRACT_STATE_CONFLICT", "Contract state has changed; refresh and retry.");
    }
    client = await db.connect();
    const context: OperationContext = {
      actor, row, contract: opened.contract, client,
      operatorAddress: async () => getAddress(await opened!.contract.getFunction("operator")()),
      call: async (method, args, signerAddress, role) => submitTransaction(opened!.provider, opened!.contract, signerAddress, role, method, args),
    };
    const response = await operation(context);
    await synchronizeContractRow(client, row, action, response);
    await completeOperation(db, reserved.operationId, row.plan_id, action, idempotencyKey, response, response.transactionHash as string | null ?? null, row.contract_id);
    return reply.code(200).send(response);
  } catch (error) {
    if (isChainUnavailable(error)) {
      await queueOperation(db, reserved.operationId, error);
      return queuedReply(reply, reserved.operationId);
    }
    await markOperationFailed(db, row.plan_id, action, idempotencyKey, error);
    if (error instanceof ActionError) return apiError(reply, error.status, error.code, error.message);
    return chainError(reply, error);
  } finally {
    client?.release();
    await opened?.provider.destroy();
  }
}

async function reserveOperation(db: Pool, value: {
  planId: string; contractId: string | null; action: string; idempotencyKey: string; requestHash: string;
  requestPayload: Record<string, unknown>; actorUserId: string; workerToken?: string; scenarioGroupId?: string;
}) {
  const operationId = randomUUID();
  if (value.action === "accept" && value.scenarioGroupId) {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [value.scenarioGroupId]);
      const result = await reserveOperationWithExecutor(client, value, operationId);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  return reserveOperationWithExecutor(db, value, operationId);
}

async function reserveOperationWithExecutor(executor: Pool | PoolClient, value: {
  planId: string; contractId: string | null; action: string; idempotencyKey: string; requestHash: string;
  requestPayload: Record<string, unknown>; actorUserId: string; workerToken?: string; scenarioGroupId?: string;
}, operationId: string) {
  const inserted = await executor.query(
    `INSERT INTO contract_operations (operation_id, plan_id, contract_id, action, idempotency_key, request_hash, status, request_payload, actor_user_id, scenario_group_id)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7::jsonb, $8, $9) ON CONFLICT (plan_id, action, idempotency_key) DO NOTHING`,
    [operationId, value.planId, value.contractId, value.action, value.idempotencyKey, value.requestHash, JSON.stringify(value.requestPayload), value.actorUserId, value.scenarioGroupId ?? null],
  );
  if (inserted.rowCount === 1) return { kind: "new" as const, operationId };
  const existing = await executor.query<{ operation_id: string; request_hash: string; status: string; response_payload: Record<string, unknown> | null; worker_token: string | null }>(
    "SELECT operation_id, request_hash, status, response_payload, worker_token FROM contract_operations WHERE plan_id = $1 AND action = $2 AND idempotency_key = $3",
    [value.planId, value.action, value.idempotencyKey],
  );
  const row = existing.rows[0];
  if (!row || row.request_hash !== value.requestHash) throw new ActionError(409, "IDEMPOTENCY_KEY_REUSED", "The idempotency key was already used with a different request.");
  if (row.status === "succeeded" && row.response_payload) return { kind: "replay" as const, payload: row.response_payload };
  if (row.status === "queued" || row.status === "processing") {
    if (row.status === "processing" && value.workerToken && row.worker_token === value.workerToken) {
      await executor.query("UPDATE contract_operations SET status = 'pending', worker_token = NULL, updated_at = now() WHERE operation_id = $1", [row.operation_id]);
      return { kind: "new" as const, operationId: row.operation_id };
    }
    return { kind: "queued" as const, operationId: row.operation_id };
  }
  if (row.status === "failed") {
    await executor.query("UPDATE contract_operations SET status = 'pending', failure_code = NULL, updated_at = now() WHERE operation_id = $1", [row.operation_id]);
    return { kind: "new" as const, operationId: row.operation_id };
  }
  return { kind: "in_progress" as const, operationId: row.operation_id };
}

async function synchronizeContractRow(client: PoolClient, row: ContractRow, action: string, response: Record<string, unknown>) {
  const state = typeof response.state === "string" ? response.state : row.state;
  await client.query("UPDATE contracts SET state = $1, penalty_paise = COALESCE($2, penalty_paise), demurrage_paise = COALESCE($3, demurrage_paise), net_payment_paise = COALESCE($4, net_payment_paise), sync_status = 'synced', updated_at = now() WHERE contract_id = $5", [
    state, typeof response.penaltyPaise === "string" ? response.penaltyPaise : null,
    typeof response.demurragePaise === "string" ? response.demurragePaise : null,
    typeof response.netPaymentPaise === "string" ? response.netPaymentPaise : null, row.contract_id,
  ]);
  if (action === "confirm_delivery") {
    await client.query(
      `UPDATE payments SET penalty_paise = $1, demurrage_paise = $2, net_paise = $3 WHERE contract_id = $4`,
      [response.penaltyPaise, response.demurragePaise, response.netPaymentPaise, row.contract_id],
    );
  } else if (action === "release_payment") {
    await client.query("UPDATE payments SET transaction_hash = $1, released_at = now() WHERE contract_id = $2", [response.transactionHash ?? null, row.contract_id]);
  } else if (action === "close") {
    await client.query("UPDATE payments SET closed_at = now() WHERE contract_id = $1", [row.contract_id]);
  } else if (action === "resolve_dispute") {
    await client.query("UPDATE payments SET penalty_paise = $1, demurrage_paise = $2, net_paise = $3 WHERE contract_id = $4", [response.penaltyPaise ?? "0", response.demurragePaise ?? "0", response.netPaymentPaise ?? row.freight_value_paise, row.contract_id]);
  }
}

async function completeOperation(db: Pool | PoolClient, operationId: string, planId: string, action: string, idempotencyKey: string, payload: Record<string, unknown>, transactionHash: string | null, contractId: string | null) {
  await db.query(
    `UPDATE contract_operations SET status = 'succeeded', response_payload = $1::jsonb,
      transaction_hash = COALESCE($2, transaction_hash), contract_id = COALESCE($3, contract_id), updated_at = now()
     WHERE operation_id = $4 AND plan_id = $5 AND action = $6 AND idempotency_key = $7`,
    [JSON.stringify(payload), transactionHash, contractId, operationId, planId, action, idempotencyKey],
  );
}

async function markOperationFailed(db: Pool, planId: string, action: string, key: string | undefined, error: unknown) {
  if (!key) return;
  await db.query(
    `UPDATE contract_operations SET status = 'failed', failure_code = $1, updated_at = now()
     WHERE plan_id = $2 AND action = $3 AND idempotency_key = $4 AND status = 'pending'`,
    [error instanceof ActionError ? error.code : "CHAIN_ERROR", planId, action, key],
  ).catch(() => undefined);
}

async function queueOperation(db: Pool, operationId: string, _error: unknown) {
  const queued = await db.query(
    `UPDATE contract_operations SET status = 'queued', worker_token = NULL, failure_code = 'BLOCKCHAIN_UNAVAILABLE',
       next_attempt_at = now() + make_interval(secs => LEAST(30, power(2, LEAST(attempt_count, 5))::integer)), updated_at = now()
     WHERE operation_id = $1 AND status IN ('pending', 'processing')`,
    [operationId],
  );
  if (queued.rowCount !== 1) throw new Error("The blockchain action could not be durably queued.");
}

function queuedReply(reply: FastifyReply, operationId: string) {
  return reply.code(202).send({ status: "queued", operationId, message: "The blockchain action is queued and will retry automatically." });
}

function isChainUnavailable(error: unknown): boolean {
  if (error instanceof ActionError) return false;
  const message = error instanceof Error ? error.message : String(error);
  return /ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|network error|fetch failed|could not detect network|timeout|socket hang up|SERVER_ERROR|missing response/i.test(message);
}

async function getVisibleContract(db: Pool, contractId: string, actor: AuthenticatedActor): Promise<ContractRow | undefined> {
  const result = actor.role === "Shipper"
    ? await db.query<ContractRow>("SELECT * FROM contracts WHERE contract_id = $1 AND shipper_id = $2", [contractId, actor.userId])
    : actor.role === "Carrier"
      ? await db.query<ContractRow>("SELECT * FROM contracts WHERE contract_id = $1 AND carrier_id = $2", [contractId, actor.userId])
      : await db.query<ContractRow>("SELECT * FROM contracts WHERE contract_id = $1", [contractId]);
  return result.rows[0];
}

function ensureRole(actor: AuthenticatedActor, role: string) {
  if (actor.role !== role) throw new ActionError(403, "FORBIDDEN", "This role cannot perform the contract action.");
}
function ensureParty(row: ContractRow, actor: AuthenticatedActor, party: "shipper" | "carrier") {
  if ((party === "shipper" ? row.shipper_id : row.carrier_id) !== actor.userId) throw new ActionError(403, "FORBIDDEN", "The authenticated user is not assigned to this contract.");
}
function apiError(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message } });
}
function getIdempotencyKey(request: FastifyRequest): string {
  const header = request.headers["idempotency-key"];
  if (typeof header !== "string" || !header.length || header.length > 128) throw new ActionError(400, "INVALID_IDEMPOTENCY_KEY", "A valid Idempotency-Key header is required.");
  return header;
}
function hashRequest(value: unknown): string { return createHash("sha256").update(canonicalJson(value)).digest("hex"); }
async function findAcceptedEvent(contract: Contract, planId: string): Promise<any | undefined> {
  const events = await contract.queryFilter("AgreementCreated", 0, "latest");
  return events.find((event: any) => String(event.args?.planId) === planId);
}
function unixSeconds(value: string): bigint {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) throw new ActionError(400, "INVALID_TIMESTAMP", "Timestamp must be a valid date-time.");
  return BigInt(Math.floor(time / 1000));
}
function parseCursor(value?: string): { createdAt: string; contractId: string } | null {
  if (!value) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (typeof decoded.createdAt === "string" && typeof decoded.contractId === "string") return decoded;
  } catch { /* bad cursor is rejected below */ }
  throw new ActionError(400, "INVALID_CURSOR", "The contract list cursor is invalid.");
}
function makeCursor(createdAt: Date, contractId: string): string { return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), contractId })).toString("base64url"); }
function contractSummary(row: ContractRow, isParty: boolean) {
  return {
    contractId: row.contract_id, planId: row.plan_id, state: row.state,
    shipperId: row.shipper_id, carrierId: row.carrier_id,
    ...(isParty ? { freightValuePaise: row.freight_value_paise, slaDeadline: row.sla_deadline.toISOString() } : {}),
  };
}
async function alreadyApplied(action: string, agreement: any, body: any, contract: Contract, contractId: bigint): Promise<boolean> {
  const state = getStateName(agreement.state);
  if (action === "confirm_booking") return state !== "Created";
  if (action === "shipment_status") {
    if (!["InTransit"].includes(state)) return false;
    const status = ["Dispatched", "CheckpointReached", "ArrivedAtDestination"].indexOf(body.status);
    const timestamp = unixSeconds(body.timestamp);
    const events = await contract.queryFilter(contract.filters.ShipmentStatusUpdated(contractId));
    return events.some((event: any) => Number(event.args.status) === status && BigInt(event.args.timestamp) === timestamp);
  }
  if (action === "confirm_delivery") return ["PenaltyCalculated", "PaymentReleased", "Closed", "Disputed"].includes(state) && Number(agreement.deliveryTimestamp) === Number(unixSeconds(body.timestamp)) && agreement.podReference === body.podReference;
  if (action === "raise_dispute") {
    if (state !== "Disputed") return false;
    const events = await contract.queryFilter(contract.filters.DisputeRaised(contractId));
    return events.some((event: any) => event.args.reasonCode === body.reasonCode);
  }
  if (action === "resolve_dispute") {
    if (state !== "PenaltyCalculated") return false;
    const events = await contract.queryFilter(contract.filters.DisputeResolved(contractId));
    const outcome = ["UpholdDeductions", "WaivePenalty", "WaiveAll"].indexOf(body.outcome);
    return events.some((event: any) => Number(event.args.outcome) === outcome);
  }
  if (action === "release_payment") return ["PaymentReleased", "Closed"].includes(state);
  if (action === "close") return state === "Closed";
  return false;
}
async function reconcileResponse(action: string, row: ContractRow, agreement: any, contract: Contract, contractId: bigint): Promise<Record<string, unknown>> {
  const state = getStateName(agreement.state);
  if (action === "confirm_delivery") {
    const penalty = BigInt(agreement.penaltyPaise); const demurrage = BigInt(agreement.demurragePaise); const gross = BigInt(row.freight_value_paise);
    return { contractId: contractId.toString(), state: "PenaltyCalculated", onTime: agreement.onTime, secondsLate: Number(agreement.secondsLate), penaltyPaise: penalty.toString(), demurragePaise: demurrage.toString(), netPaymentPaise: (gross - penalty - demurrage).toString() };
  }
  if (action === "release_payment") {
    const events = await contract.queryFilter(contract.filters.PaymentReleased(contractId));
    return { contractId: contractId.toString(), state, netPaymentPaise: agreement.netPaymentPaise.toString(), ...(events.length ? { transactionHash: events.at(-1)!.transactionHash } : {}) };
  }
  if (action === "close") {
    const events = await contract.queryFilter(contract.filters.ContractClosed(contractId));
    return { contractId: contractId.toString(), state, ...(events.length ? { transactionHash: events.at(-1)!.transactionHash } : {}) };
  }
  return { contractId: contractId.toString(), state };
}
function chainError(reply: FastifyReply, error: unknown) {
  const text = error instanceof Error ? error.message : "";
  if (/revert|InvalidTerms|InvalidState|UnknownContract|NotCarrier|NotAuthorized|InvalidTimestamp|EmptyProof/i.test(text)) {
    return apiError(reply, /InvalidTerms|InvalidTimestamp|EmptyProof/i.test(text) ? 400 : 409, /InvalidTerms|InvalidTimestamp|EmptyProof/i.test(text) ? "INVALID_CHAIN_INPUT" : "CONTRACT_STATE_CONFLICT", "The settlement contract rejected the requested state change.");
  }
  return apiError(reply, 503, "BLOCKCHAIN_UNAVAILABLE", "The blockchain settlement service is unavailable.");
}
class ActionError extends Error {
  readonly statusCode: number;
  constructor(readonly status: number, readonly code: string, message: string) { super(message); this.statusCode = status; }
}
