import type { FastifyInstance } from "fastify";
import { JsonRpcProvider, keccak256, toUtf8Bytes, type Contract, type Log } from "ethers";
import type { Pool } from "pg";
import { canonicalJson, getStateName, openSettlement } from "./chain.js";
import type { ContractPushEvent } from "./push.js";

const SYNC_LOCK_ID = "7542101901";
const EVENT_NAMES = [
  "AgreementCreated", "BookingConfirmed", "ShipmentStatusUpdated", "DeliveryConfirmed",
  "PenaltyCalculated", "DemurrageCalculated", "PaymentReleased", "ContractClosed",
  "DisputeRaised", "DisputeResolved",
] as const;
const EVENT_ACTION: Record<string, number> = {
  AgreementCreated: 0, BookingConfirmed: 1, ShipmentStatusUpdated: 2, DeliveryConfirmed: 3,
  PenaltyCalculated: 4, DemurrageCalculated: 5, PaymentReleased: 6, DisputeRaised: 7,
  DisputeResolved: 8, ContractClosed: 9,
};
const SHIPMENT_STATUS = ["Dispatched", "CheckpointReached", "ArrivedAtDestination"];
type PushTarget = { broadcast: (event: ContractPushEvent, shipperId: string, carrierId: string) => void };

export function startContractSync(
  app: FastifyInstance,
  database: Pool,
  chainRpcUrl: string,
  artifactPath: string,
  push: PushTarget,
) {
  let syncRunning = false;
  let retryRunning = false;
  const pollTimer = setInterval(() => void runSync(), 2000);
  const reconcileTimer = setInterval(() => void reconcile(), 30_000);
  const queueTimer = setInterval(() => void retryQueue(), 2000);
  pollTimer.unref(); reconcileTimer.unref(); queueTimer.unref();
  const startupTimer = setTimeout(() => void runSync(), 1000);
  startupTimer.unref();
  app.addHook("onClose", async () => {
    clearInterval(pollTimer); clearInterval(reconcileTimer); clearInterval(queueTimer); clearTimeout(startupTimer);
  });

  async function runSync() {
    if (syncRunning) return;
    syncRunning = true;
    const lock = await database.connect().catch(() => undefined);
    let opened: Awaited<ReturnType<typeof openSettlement>> | undefined;
    if (!lock) { syncRunning = false; return; }
    let hasLock = false;
    try {
      const locked = await lock.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1::bigint) AS locked", [SYNC_LOCK_ID]);
      hasLock = locked.rows[0]?.locked === true;
      if (!hasLock) return;
      opened = await openSettlement(chainRpcUrl, artifactPath);
      const chainId = (await opened.provider.getNetwork()).chainId;
      const cursor = await database.query<{ chain_id: string; last_synced_block: string }>(
        "SELECT chain_id::text, last_synced_block::text FROM chain_sync_state WHERE sync_name = 'settlement'",
      );
      if (!cursor.rowCount) {
        await database.query("INSERT INTO chain_sync_state (sync_name, chain_id, last_synced_block) VALUES ('settlement', $1, 0)", [chainId.toString()]);
      } else if (BigInt(cursor.rows[0].chain_id) !== chainId) {
        throw new Error("Cached settlement events belong to a different chain ID.");
      }
      const lastBlock = BigInt(cursor.rows[0]?.last_synced_block ?? "0");
      const latestBlock = BigInt(await opened.provider.getBlockNumber());
      if (latestBlock > lastBlock) {
        const fromBlock = Number(lastBlock + 1n);
        const toBlock = Number(latestBlock);
        const logs: Array<{ log: Log; name: string; args: any }> = [];
        for (const eventName of EVENT_NAMES) {
          const entries = await opened.contract.queryFilter(eventName, fromBlock, toBlock);
          for (const log of entries) {
            const parsed = opened.contract.interface.parseLog({ topics: log.topics, data: log.data });
            if (parsed) logs.push({ log: log as Log, name: parsed.name, args: parsed.args });
          }
        }
        logs.sort((left, right) => left.log.blockNumber - right.log.blockNumber || left.log.index - right.log.index);
        for (const entry of logs) await cacheLog(database, opened.contract, opened.provider, entry.log, entry.name, entry.args, push);
        await database.query("UPDATE chain_sync_state SET last_synced_block = $1, updated_at = now() WHERE sync_name = 'settlement'", [latestBlock.toString()]);
      }
    } catch (error) {
      app.log.warn({ err: error }, "Settlement event sync is temporarily unavailable");
    } finally {
      await opened?.provider.destroy();
      if (hasLock) await lock.query("SELECT pg_advisory_unlock($1::bigint)", [SYNC_LOCK_ID]).catch(() => undefined);
      lock.release();
      syncRunning = false;
    }
  }

  async function reconcile() {
    let opened: Awaited<ReturnType<typeof openSettlement>> | undefined;
    try {
      opened = await openSettlement(chainRpcUrl, artifactPath);
      const rows = await database.query<{ contract_id: string }>("SELECT contract_id FROM contracts ORDER BY contract_id");
      for (const row of rows.rows) {
        try { await reconcileContract(database, opened.contract, row.contract_id); }
        catch (error) { app.log.warn({ contractId: row.contract_id, err: error }, "Contract cache reconciliation failed"); }
      }
    } catch (error) {
      app.log.debug({ err: error }, "Contract reconciliation is waiting for the chain");
    } finally { await opened?.provider.destroy(); }
  }

  async function retryQueue() {
    if (retryRunning) return;
    retryRunning = true;
    const client = await database.connect().catch(() => undefined);
    if (!client) { retryRunning = false; return; }
    try {
      await client.query("BEGIN");
      await client.query("UPDATE contract_operations SET status = 'queued', worker_token = NULL, updated_at = now() WHERE status = 'processing' AND updated_at < now() - interval '2 minutes'");
      const pending = await client.query<{
        operation_id: string; plan_id: string; contract_id: string | null; action: string; idempotency_key: string;
        request_payload: Record<string, unknown>; actor_user_id: string; role: "Shipper" | "Carrier" | "Administrator" | "Auditor"; worker_token: string;
      }>(
        `SELECT op.operation_id, op.plan_id, op.contract_id, op.action, op.idempotency_key, op.request_payload,
                op.actor_user_id, users.role, gen_random_uuid()::text AS worker_token
         FROM contract_operations op JOIN users ON users.user_id = op.actor_user_id
         WHERE op.status = 'queued' AND op.next_attempt_at <= now() AND users.active = true
         ORDER BY op.created_at FOR UPDATE OF op SKIP LOCKED LIMIT 10`,
      );
      for (const operation of pending.rows) {
        await client.query(
          `UPDATE contract_operations SET status = 'processing', worker_token = $1, attempt_count = attempt_count + 1,
             next_attempt_at = now() + make_interval(secs => LEAST(120, power(2, LEAST(attempt_count, 7))::integer)), updated_at = now()
           WHERE operation_id = $2`,
          [operation.worker_token, operation.operation_id],
        );
      }
      await client.query("COMMIT");
      for (const operation of pending.rows) {
        const token = await app.jwt.sign({ sub: operation.actor_user_id, role: operation.role });
        const route = operationRoute(operation.action, operation.plan_id, operation.contract_id);
        if (!route) continue;
        try {
          await app.inject({
            method: "POST", url: route, headers: {
              authorization: `Bearer ${token}`,
              "idempotency-key": operation.idempotency_key,
              "x-chainroute-worker-token": operation.worker_token,
            }, payload: operation.request_payload,
          });
        } catch (error) {
          app.log.warn({ operationId: operation.operation_id, err: error }, "Queued contract operation retry failed");
          await database.query("UPDATE contract_operations SET status = 'queued', worker_token = NULL, updated_at = now() WHERE operation_id = $1 AND status = 'processing'", [operation.operation_id]);
        }
      }
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      app.log.warn({ err: error }, "Contract operation queue scan failed");
    } finally { client.release(); retryRunning = false; }
  }
}

function operationRoute(action: string, planId: string, contractId: string | null): string | undefined {
  if (action === "accept") return `/plans/${encodeURIComponent(planId)}/accept`;
  if (!contractId) return undefined;
  const paths: Record<string, string> = {
    confirm_booking: "confirm-booking", shipment_status: "shipment-status", confirm_delivery: "confirm-delivery",
    raise_dispute: "dispute", resolve_dispute: "resolve-dispute", release_payment: "release-payment", close: "close",
  };
  const suffix = paths[action];
  return suffix ? `/contracts/${encodeURIComponent(contractId)}/${suffix}` : undefined;
}

async function cacheLog(
  database: Pool,
  contract: Contract,
  provider: JsonRpcProvider,
  log: Log,
  name: string,
  args: any,
  push: PushTarget,
) {
  const contractId = BigInt(args.contractId).toString();
  if (name === "AgreementCreated") await rebuildContract(database, contract, contractId);
  const contractRow = await database.query<{ shipper_id: string; carrier_id: string }>(
    "SELECT shipper_id, carrier_id FROM contracts WHERE contract_id = $1", [contractId],
  );
  if (!contractRow.rowCount) return;
  const state = await reconcileContract(database, contract, contractId, log.blockNumber);
  const block = await provider.getBlock(log.blockNumber);
  const occurredAt = new Date(Number(block?.timestamp ?? 0) * 1000).toISOString();
  const statusText = name === "ShipmentStatusUpdated" ? SHIPMENT_STATUS[Number(args.status)] ?? "Unknown" : null;
  const payload = eventPayload(name, args, statusText);
  const actionIndex = EVENT_ACTION[name];
  const status = await contract.getFunction("getContractStatus")(BigInt(contractId));
  const history = status[1] as Array<{ action: bigint; actor: string; timestamp: bigint; dataHash: string }>;
  const actionHistory = [...history].reverse().find((item) => Number(item.action) === actionIndex);
  const dataHash = actionHistory?.dataHash ?? keccak256(toUtf8Bytes(canonicalJson({ transactionHash: log.transactionHash, logIndex: log.index, payload })));
  const actorAddress = eventActor(name, args, await contract.getFunction("operator")());
  const inserted = await database.query(
    `INSERT INTO contract_events (contract_id, action, actor_address, occurred_at, data_hash, transaction_hash, block_number, log_index, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     ON CONFLICT (transaction_hash, log_index) DO NOTHING`,
    [contractId, name, actorAddress, occurredAt, dataHash, log.transactionHash, log.blockNumber, log.index, JSON.stringify(payload)],
  );
  if (name === "ShipmentStatusUpdated") {
    await database.query(
      `INSERT INTO delivery_events (contract_id, shipment_status, actor_address, transaction_hash)
       VALUES ($1, $2, $3, $4) ON CONFLICT (transaction_hash) DO NOTHING`,
      [contractId, statusText, actorAddress, log.transactionHash],
    );
  } else if (name === "DeliveryConfirmed") {
    const agreement = status[0];
    await database.query(
      `INSERT INTO delivery_events (contract_id, delivery_timestamp, pod_reference, on_time, seconds_late, actor_address, transaction_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (transaction_hash) DO NOTHING`,
      [contractId, new Date(Number(args.timestamp) * 1000), args.podReference, agreement.onTime, agreement.secondsLate.toString(), actorAddress, log.transactionHash],
    );
  }
  if (inserted.rowCount) {
    push.broadcast({ contractId, action: name, occurredAt, transactionHash: log.transactionHash, state }, contractRow.rows[0].shipper_id, contractRow.rows[0].carrier_id);
  }
}

async function rebuildContract(database: Pool, contract: Contract, contractId: string) {
  const result = await contract.getFunction("getContractStatus")(BigInt(contractId));
  const agreement = result[0];
  const plan = await database.query<{ created_by: string; plan_payload: Record<string, any>; scenario_group_id: string }>("SELECT created_by, plan_payload, scenario_group_id FROM allocation_plans WHERE plan_id = $1", [agreement.planId]);
  if (!plan.rowCount) return;
  const users = await database.query<{ user_id: string; role: string }>("SELECT user_id, role FROM users WHERE lower(chain_address) IN (lower($1), lower($2))", [agreement.shipper, agreement.carrier]);
  const shipper = users.rows.find((user) => user.role === "Shipper");
  const carrier = users.rows.find((user) => user.role === "Carrier");
  if (!shipper || !carrier) return;
  const terms = agreement.terms;
  const normalizedTerms = {
    freightValuePaise: terms.freightValuePaise.toString(), slaDeadline: new Date(Number(terms.slaDeadline) * 1000).toISOString(),
    penaltyBpsPerBlock: Number(terms.penaltyBpsPerBlock), penaltyBlockSeconds: Number(terms.penaltyBlockSeconds),
    freeHoldingHours: Number(terms.freeHoldingHours), demurrageRatePaisePerWagonHour: terms.demurrageRatePaisePerWagonHour.toString(), wagonCount: Number(terms.wagonCount),
  };
  await database.query(
    `INSERT INTO contracts (contract_id, plan_id, scenario_group_id, shipper_id, carrier_id, shipper_address, carrier_address, state, terms_hash, terms, assignments,
      freight_value_paise, sla_deadline, penalty_paise, demurrage_paise, net_payment_paise, sync_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13, $14, $15, $16, 'synced')
     ON CONFLICT (contract_id) DO NOTHING`,
    [contractId, agreement.planId, plan.rows[0].scenario_group_id, shipper.user_id, carrier.user_id, agreement.shipper, agreement.carrier, getStateName(agreement.state),
      terms.termsHash, JSON.stringify(normalizedTerms), JSON.stringify(plan.rows[0].plan_payload.assignments), normalizedTerms.freightValuePaise,
      normalizedTerms.slaDeadline, agreement.penaltyPaise.toString(), agreement.demurragePaise.toString(), agreement.netPaymentPaise.toString()],
  );
  await database.query(
    `INSERT INTO payments (contract_id, gross_paise, penalty_paise, demurrage_paise, net_paise)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT (contract_id) DO NOTHING`,
    [contractId, normalizedTerms.freightValuePaise, agreement.penaltyPaise.toString(), agreement.demurragePaise.toString(), agreement.netPaymentPaise === 0n ? normalizedTerms.freightValuePaise : agreement.netPaymentPaise.toString()],
  );
}

export async function reconcileContract(database: Pool, contract: Contract, contractId: string, syncedBlock?: number): Promise<string> {
  const result = await contract.getFunction("getContractStatus")(BigInt(contractId));
  const agreement = result[0];
  const state = getStateName(agreement.state);
  await database.query(
    `UPDATE contracts SET state = $1, penalty_paise = $2, demurrage_paise = $3, net_payment_paise = $4,
       last_synced_block = COALESCE($5, last_synced_block), sync_status = 'synced', updated_at = now() WHERE contract_id = $6`,
    [state, agreement.penaltyPaise.toString(), agreement.demurragePaise.toString(), agreement.netPaymentPaise.toString(), syncedBlock?.toString() ?? null, contractId],
  );
  if (["PaymentReleased", "Closed"].includes(state)) {
    await database.query("UPDATE payments SET penalty_paise = $1, demurrage_paise = $2, net_paise = $3, released_at = COALESCE(released_at, now()), closed_at = CASE WHEN $4 THEN COALESCE(closed_at, now()) ELSE closed_at END WHERE contract_id = $5", [
      agreement.penaltyPaise.toString(), agreement.demurragePaise.toString(), agreement.netPaymentPaise.toString(), state === "Closed", contractId,
    ]);
  } else if (["PenaltyCalculated", "Disputed"].includes(state)) {
    const gross = BigInt(agreement.terms.freightValuePaise);
    await database.query("UPDATE payments SET penalty_paise = $1, demurrage_paise = $2, net_paise = $3 WHERE contract_id = $4", [agreement.penaltyPaise.toString(), agreement.demurragePaise.toString(), (gross - BigInt(agreement.penaltyPaise) - BigInt(agreement.demurragePaise)).toString(), contractId]);
  }
  return state;
}

function eventActor(name: string, args: any, operator: string): string {
  if (name === "AgreementCreated" || name === "PaymentReleased" || name === "ContractClosed" || name === "PenaltyCalculated" || name === "DemurrageCalculated" || name === "DisputeResolved") return operator;
  return args.actor ?? args.carrier ?? args.raisedBy ?? operator;
}

function eventPayload(name: string, args: any, shipmentStatus: string | null): Record<string, unknown> {
  if (name === "ShipmentStatusUpdated") return { status: shipmentStatus, timestamp: String(args.timestamp) };
  if (name === "DeliveryConfirmed") return { timestamp: String(args.timestamp) };
  if (name === "DisputeRaised") return { reasonCode: String(args.reasonCode) };
  if (name === "DisputeResolved") return { outcome: Number(args.outcome), penaltyPaise: String(args.penaltyPaise), demurragePaise: String(args.demurragePaise) };
  if (name === "PaymentReleased") return { grossPaise: String(args.grossPaise), penaltyPaise: String(args.penaltyPaise), demurragePaise: String(args.demurragePaise), netPaymentPaise: String(args.netPaymentPaise) };
  if (name === "PenaltyCalculated") return { penaltyPaise: String(args.penaltyPaise), secondsLate: String(args.secondsLate) };
  if (name === "DemurrageCalculated") return { demurragePaise: String(args.demurragePaise), heldSeconds: String(args.heldSeconds) };
  return {};
}
