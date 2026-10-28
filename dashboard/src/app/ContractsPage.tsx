import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { CONTRACT_STATES, getContract, listContracts, performContractAction, type ContractAction, type ContractDetail, type ContractState, type ContractSummary, type QueuedContractAction } from "../api/contracts";
import { ApiError } from "../api/errors";
import { downloadCsv, safeCsvFilename, settlementCsv } from "../api/csv";
import { useAuth } from "../auth/context";
import { hasPermission, isRole, type Role } from "../auth/roles";
import { EmptyState, ErrorState, LoadingState } from "../components/StatePanel";

const FLOW: ContractState[] = ["Created", "Booked", "InTransit", "Delivered", "PenaltyCalculated", "PaymentReleased", "Closed"];
const STATE_LABEL: Record<ContractState, string> = { Created: "Created", Booked: "Booked", InTransit: "In transit", Delivered: "Delivered", PenaltyCalculated: "Penalty calculated", PaymentReleased: "Payment released", Closed: "Closed", Disputed: "Disputed" };
const ACTION_LABEL: Record<ContractAction, string> = {
  "confirm-booking": "Confirm booking", "shipment-status": "Update shipment status", "confirm-delivery": "Confirm delivery",
  dispute: "Raise a dispute", "resolve-dispute": "Resolve dispute", "release-payment": "Release payment", close: "Close contract",
};

export function ContractsPage() {
  const { contractId } = useParams();
  const { session } = useAuth();
  return contractId ? <ContractDetailPage contractId={contractId} role={session?.user.role} /> : <ContractListPage role={session?.user.role} />;
}

function ContractListPage({ role }: { role?: string }) {
  const [contracts, setContracts] = useState<ContractSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<"All" | ContractState>("All");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sampleData, setSampleData] = useState(false);

  const load = useCallback(async (more = false) => {
    more ? setLoadingMore(true) : setLoading(true);
    setError(null);
    try {
      const page = await listContracts({ ...(stateFilter !== "All" ? { state: stateFilter } : {}), ...(more && cursor ? { cursor } : {}) });
      setContracts((current) => more ? [...current, ...page.items] : page.items);
      setCursor(page.nextCursor);
      setSampleData(Boolean((page as typeof page & { sampleData?: boolean }).sampleData));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The contract list could not be loaded.");
    } finally { setLoading(false); setLoadingMore(false); }
  }, [cursor, stateFilter]);

  useEffect(() => { void load(); }, [stateFilter]);
  useEffect(() => {
    const handleContractEvent = () => void load();
    window.addEventListener("chainroute:contract-event", handleContractEvent);
    return () => window.removeEventListener("chainroute:contract-event", handleContractEvent);
  }, [load]);
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return contracts;
    return contracts.filter((contract) => [contract.contractId, contract.planId, contract.state, contract.shipperId, contract.carrierId].some((value) => value.toLowerCase().includes(query)));
  }, [contracts, search]);

  if (loading && !contracts.length) return <LoadingState label="Bringing contract records into view…" />;
  return <section className="contracts-page" aria-labelledby="contracts-title">
    <header className="overview-heading contracts-heading"><div><p className="eyebrow"><span className="eyebrow-mark" /> LEDGER / LIFECYCLE</p><h1 id="contracts-title">Every handoff, recorded.</h1><p className="overview-intro">Search the agreements and follow each one through its verified state history.</p></div><span className="contracts-count"><strong>{visible.length}</strong><small>{visible.length === 1 ? "record shown" : "records shown"}</small></span></header>
    {sampleData && <p className="overview-sample" role="status"><span aria-hidden="true">✳</span> Sample contracts · synthetic activity</p>}
    <div className="contract-filters"><label>Find a contract<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ID, plan, party, or state" type="search" /></label><label>Lifecycle state<select value={stateFilter} onChange={(event) => setStateFilter(event.target.value as "All" | ContractState)}><option value="All">All states</option>{CONTRACT_STATES.map((state) => <option key={state} value={state}>{STATE_LABEL[state]}</option>)}</select></label><button className="secondary-button" type="button" disabled={loading} onClick={() => void load()}>↻ Refresh</button></div>
    {error && <div className="contracts-error" role="alert"><strong>Contract records unavailable</strong><p>{error}</p><button className="secondary-button" onClick={() => void load()} type="button">Try again</button></div>}
    {!error && visible.length === 0 ? <section className="contracts-empty"><EmptyState title={contracts.length ? "No matching agreements" : "No contracts in this ledger yet"}><p>{contracts.length ? "Try another search or clear the lifecycle filter." : "When an allocation is accepted, its contract appears here."}</p>{contracts.length > 0 && <button className="text-link" onClick={() => { setSearch(""); setStateFilter("All"); }} type="button">Clear filters <span aria-hidden="true">↗</span></button>}{(role === "Shipper" || role === "Administrator") && <Link className="panel-link" to="/allocations">Build an allocation <span aria-hidden="true">→</span></Link>}</EmptyState></section> : <div className="contract-list" aria-label="Contracts">
      {visible.map((contract, index) => <ContractRow key={contract.contractId} contract={contract} index={index} />)}
    </div>}
    {!error && cursor && <button className="secondary-button contract-load-more" disabled={loadingMore} onClick={() => void load(true)} type="button">{loadingMore ? "Loading more…" : "Load more contracts"}<span aria-hidden="true"> ↓</span></button>}
  </section>;
}

function ContractRow({ contract, index }: { contract: ContractSummary; index: number }) {
  return <Link className={`contract-row${contract.state === "Disputed" ? " is-disputed" : ""}`} to={`/contracts/${encodeURIComponent(contract.contractId)}`} style={{ "--item-index": index } as React.CSSProperties}>
    <span className="contract-row-id"><small>CONTRACT</small><strong>{contract.contractId}</strong></span>
    <span className="contract-row-state"><StateBadge state={contract.state} /><small>Plan {contract.planId}</small></span>
    <span className="contract-row-party"><small>SHIPPER</small><strong>{contract.shipperId}</strong></span>
    <span className="contract-row-party"><small>CARRIER</small><strong>{contract.carrierId}</strong></span>
    {contract.slaDeadline && <span className="contract-row-deadline"><small>SLA DEADLINE</small><strong>{formatDate(contract.slaDeadline)}</strong></span>}
    <span className="contract-row-arrow" aria-hidden="true">↗</span>
  </Link>;
}

function ContractDetailPage({ contractId, role }: { contractId: string; role?: string }) {
  const navigate = useNavigate();
  const [detail, setDetail] = useState<ContractDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<ContractAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [sampleData, setSampleData] = useState(false);
  const idempotencyKeys = useRef(new Map<ContractAction, { key: string; body?: Record<string, string> }>());

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const result = await getContract(contractId);
      setDetail(result);
      setSampleData(Boolean((result as ContractDetail & { sampleData?: boolean }).sampleData));
    } catch (cause) {
      setDetail(null);
      setError(cause instanceof ApiError && cause.status === 404 ? "This contract was not found or is outside your account’s access." : cause instanceof Error ? cause.message : "The contract could not be loaded.");
    } finally { setLoading(false); }
  }, [contractId]);
  useEffect(() => { void refresh(); setAction(null); setActionNotice(null); idempotencyKeys.current.clear(); }, [refresh]);
  useEffect(() => {
    const handleContractEvent = (event: Event) => {
      const contractEvent = (event as CustomEvent<{ contractId?: string }>).detail;
      if (contractEvent?.contractId === contractId) void refresh();
    };
    window.addEventListener("chainroute:contract-event", handleContractEvent);
    return () => window.removeEventListener("chainroute:contract-event", handleContractEvent);
  }, [contractId, refresh]);

  async function submitAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action || acting) return;
    const form = new FormData(event.currentTarget);
    let body: Record<string, string> | undefined;
    if (action === "shipment-status") body = { status: String(form.get("status")), timestamp: new Date(String(form.get("timestamp"))).toISOString() };
    if (action === "confirm-delivery") body = { timestamp: new Date(String(form.get("timestamp"))).toISOString(), podReference: String(form.get("podReference") ?? "").trim() };
    if (action === "dispute") body = { reasonCode: String(form.get("reasonCode") ?? "").trim() };
    if (action === "resolve-dispute") body = { outcome: String(form.get("outcome")) };
    const saved = idempotencyKeys.current.get(action);
    const key = saved?.key ?? `contract-${contractId}-${action}-${crypto.randomUUID()}`;
    if (saved) body = saved.body;
    else idempotencyKeys.current.set(action, { key, body });
    setActing(true); setActionError(null); setActionNotice(null);
    try {
      const result = await performContractAction(contractId, action, body, key);
      if ("status" in result && result.status === "queued") {
        setActionNotice(`${result.message} Operation ${result.operationId}. Retry here later to check its status.`);
      } else {
        idempotencyKeys.current.delete(action);
        setAction(null);
        setActionNotice(`${ACTION_LABEL[action]} recorded. Contract state and event history are updated.`);
        await refresh();
      }
    } catch (cause) {
      if (cause instanceof ApiError && cause.status >= 400 && cause.status < 500 && ![408, 429].includes(cause.status)) idempotencyKeys.current.delete(action);
      setActionError(cause instanceof ApiError ? cause.message : "The action could not be completed.");
    } finally { setActing(false); }
  }

  if (loading && !detail) return <LoadingState label={`Loading contract ${contractId}…`} />;
  if (error || !detail) return <section className="contract-detail-page"><ErrorState title="Contract unavailable" action={<div className="contract-error-actions"><button className="secondary-button" onClick={() => void refresh()} type="button">Try again</button><button className="text-link" onClick={() => navigate("/contracts")} type="button">Back to contracts</button></div>}><p>{error ?? "The contract could not be loaded."}</p></ErrorState></section>;

  const redacted = !detail.terms && !detail.assignments;
  const history = [...(detail.history ?? [])].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const actions = availableActions(detail.state, role);
  const currentIndex = detail.state === "Disputed" ? -1 : FLOW.indexOf(detail.state);
  const latestRecorded = Math.max(0, ...history.map(event => Date.parse(event.timestamp)).filter(Number.isFinite));
  const suggestedEventTime = new Date(Math.max(Date.now(), latestRecorded));
  const localEventTime = new Date(suggestedEventTime.getTime() - suggestedEventTime.getTimezoneOffset() * 60000).toISOString().slice(0, 19);

  return <section className="contract-detail-page" aria-labelledby="contract-detail-title">
    <div className="contract-breadcrumb"><Link to="/contracts"><span aria-hidden="true">←</span> Contract ledger</Link><span>/</span><span>{detail.contractId}</span></div>
    <header className="contract-detail-heading"><div><p className="eyebrow"><span className="eyebrow-mark" /> AGREEMENT / {detail.planId}</p><div className="contract-title-line"><h1 id="contract-detail-title">Contract {detail.contractId}</h1><StateBadge state={detail.state} /></div><p className="overview-intro">A recorded freight agreement with a verified state trail.</p></div><div className={`sync-stamp${sampleData ? " is-sample" : ""}`}><i />{sampleData ? "SAMPLE RECORD" : "CACHED · LIVE SYNC"}</div></header>
    {actionNotice && <div className="contract-notice" role="status">{actionNotice}<button type="button" aria-label="Dismiss status" onClick={() => setActionNotice(null)}>×</button></div>}
    <ContractTimeline state={detail.state} currentIndex={currentIndex} />
    <div className="contract-detail-grid">
      <section className="optimization-panel contract-terms-panel"><div className="panel-heading"><div><p className="eyebrow">IMMUTABLE RECORD</p><h2>Agreement terms</h2></div><span className="optimization-step">01</span></div>
        {redacted ? <div className="redacted-note"><span aria-hidden="true">▤</span><strong>Commercial terms are private to the contract parties.</strong><p>You can review lifecycle state and party identifiers for audit visibility.</p></div> : <><div className="contract-parties"><div><small>SHIPPER</small><strong>{detail.shipperId}</strong></div><span aria-hidden="true">↔</span><div><small>CARRIER</small><strong>{detail.carrierId}</strong></div></div>
          <dl className="contract-terms-list"><Term label="Plan reference" value={detail.planId} /><Term label="Freight value" value={formatPaise(detail.terms?.freightValuePaise)} /><Term label="SLA deadline" value={formatDate(detail.terms?.slaDeadline ?? "")} /><Term label="Penalty per block" value={`${detail.terms?.penaltyBpsPerBlock ?? 0} BPS / ${detail.terms?.penaltyBlockSeconds ?? 0}s`} /><Term label="Free holding" value={`${detail.terms?.freeHoldingHours ?? 0} hours`} /><Term label="Demurrage rate" value={`${formatPaise(detail.terms?.demurrageRatePaisePerWagonHour)} / wagon-hour`} /><Term label="Wagons committed" value={String(detail.terms?.wagonCount ?? 0)} /><Term label="Terms hash" value={detail.termsHash ?? "—"} mono /></dl>
        </>}
      </section>
      <section className="optimization-panel contract-actions-panel"><div className="panel-heading"><div><p className="eyebrow">ROLE / STATE GATES</p><h2>Next actions</h2></div><span className="optimization-step">02</span></div>
        {role === "Auditor" ? <div className="redacted-note"><span aria-hidden="true">◉</span><strong>Auditor view is read-only.</strong><p>Lifecycle actions remain with the assigned parties and operator.</p></div> : actions.length === 0 ? <div className="redacted-note"><span aria-hidden="true">✓</span><strong>No action is waiting on this role.</strong><p>Available actions change with contract state and party assignment.</p></div> : <div className="available-actions">{actions.map((item) => <button className={`contract-action-button${item === action ? " is-selected" : ""}`} key={item} onClick={() => { setAction(action === item ? null : item); setActionError(null); }} disabled={acting} type="button"><span aria-hidden="true">{actionIcon(item)}</span>{ACTION_LABEL[item]}<i aria-hidden="true">{action === item ? "−" : "↗"}</i></button>)}</div>}
        {action && <form className="contract-action-form" onSubmit={(event) => void submitAction(event)}><div><p className="eyebrow">CONFIRM / {ACTION_LABEL[action].toUpperCase()}</p><p>{actionDescription(action)}</p></div>
          {action === "shipment-status" && <label>Milestone<select name="status" defaultValue="Dispatched"><option value="Dispatched">Dispatched</option><option value="CheckpointReached">Checkpoint reached</option><option value="ArrivedAtDestination">Arrived at destination</option></select></label>}
          {(action === "shipment-status" || action === "confirm-delivery") && <label>Event time<input name="timestamp" type="datetime-local" step="1" defaultValue={localEventTime} required /><small>Local time; stored in UTC. Choose the observed milestone time, at or after the previous record. The local demonstration chain may have been advanced to simulate a late delivery.</small></label>}
          {action === "confirm-delivery" && <label>Proof of delivery reference<input name="podReference" placeholder="Delivery note or POD reference" required maxLength={256} /></label>}
          {action === "dispute" && <label>Dispute reason<input name="reasonCode" placeholder="Describe the issue" required maxLength={128} /></label>}
          {action === "resolve-dispute" && <label>Resolution<select name="outcome" defaultValue="UpholdDeductions"><option value="UpholdDeductions">Uphold deductions</option><option value="WaivePenalty">Waive penalty</option><option value="WaiveAll">Waive all deductions</option></select></label>}
          {actionError && <p className="form-error" role="alert">{actionError}</p>}
          <div className="contract-action-form-buttons"><button className="secondary-button" onClick={() => setAction(null)} disabled={acting} type="button">Cancel</button><button className="primary-button" disabled={acting} type="submit">{acting ? "Recording…" : actionNotice?.includes("Operation ") ? "Check action status" : action === "confirm-booking" ? "Record booking" : `Confirm ${ACTION_LABEL[action].toLowerCase()}`}<span aria-hidden="true"> ↗</span></button></div>
        </form>}
      </section>
      {!redacted && <section className="optimization-panel contract-assignment-panel"><div className="panel-heading"><div><p className="eyebrow">PLAN SNAPSHOT</p><h2>Committed assignments</h2></div><span className="panel-count">{detail.assignments?.length ?? 0} loads</span></div>{detail.assignments?.length ? <div className="assignment-table-wrap" tabIndex={0} role="region" aria-label="Scrollable data table"><table className="assignment-table contract-assignment-table"><thead><tr><th>Order</th><th>Load</th><th>Wagons</th><th>Route</th><th>Schedule</th></tr></thead><tbody>{detail.assignments.map((assignment) => <tr key={assignment.orderId}><td><strong>{assignment.orderId}</strong></td><td>{assignment.quantityTonnes} t · {assignment.cargoType}</td><td>{assignment.wagonIds.join(", ")}</td><td><strong>{assignment.route.origin} → {assignment.route.destination}</strong><small>{assignment.route.routeId}</small></td><td><strong>Depart · {formatDate(assignment.departAt)}</strong><small>ETA · {formatDate(assignment.eta)}</small></td></tr>)}</tbody></table></div> : <EmptyState title="No assigned wagons"><p>This plan did not include a contracted assignment.</p></EmptyState>}</section>}
      {!redacted && <TrackingPanel detail={detail} history={history} />}
      <section className="optimization-panel contract-history-panel"><div className="panel-heading"><div><p className="eyebrow">APPEND-ONLY EVENT LOG</p><h2>State history</h2></div><span className="panel-count">{history.length} events</span></div>{history.length ? <ol className="contract-history">{history.map((event, index) => <li key={`${event.timestamp}-${event.dataHash}`} style={{ "--item-index": index } as React.CSSProperties}><span className="history-node" aria-hidden="true">{index + 1}</span><div className="history-event"><strong>{humanizeEvent(event.action)}</strong><small>{formatDate(event.timestamp)} · {event.actor}</small><code>{event.dataHash}</code></div></li>)}</ol> : <div className="redacted-note"><strong>{redacted ? "Event detail is not included in this role’s redacted view." : "No cached lifecycle events yet."}</strong><p>The displayed state remains available while the event log synchronizes.</p></div>}</section>
      <SettlementBreakdown detail={detail} history={history} redacted={redacted} />
    </div>
  </section>;
}

function TrackingPanel({ detail, history }: { detail: ContractDetail; history: ContractDetail["history"] }) {
  const shipmentEvents = (history ?? []).filter((event) => event.action === "ShipmentStatusUpdated" && typeof event.details?.status === "string");
  const lastShipment = shipmentEvents.at(-1);
  const lastStatus = typeof lastShipment?.details?.status === "string" ? lastShipment.details.status : null;
  const delivery = [...(history ?? [])].reverse().find((event) => event.action === "DeliveryConfirmed");
  const delivered = ["Delivered", "PenaltyCalculated", "PaymentReleased", "Closed", "Disputed"].includes(detail.state);
  const stages = ["Dispatched", "CheckpointReached", "ArrivedAtDestination", "Delivered"];
  const stageIndex = delivered ? 3 : Math.max(-1, stages.indexOf(lastStatus ?? ""));
  const plannedEta = (detail.assignments ?? []).map((assignment) => Date.parse(assignment.eta)).filter(Number.isFinite).sort((a, b) => b - a)[0];
  const sla = Date.parse(detail.terms?.slaDeadline ?? "");
  const deliveredAt = typeof delivery?.details?.timestamp === "string" ? Date.parse(delivery.details.timestamp) : Date.parse(delivery?.timestamp ?? "");
  const deliveryKnown = delivered && Number.isFinite(deliveredAt);
  const atRisk = deliveryKnown ? deliveredAt > sla : Number.isFinite(plannedEta) && Number.isFinite(sla) && plannedEta > sla;
  const serviceLabel = deliveryKnown ? atRisk ? "Delivered after SLA" : "SLA met" : atRisk ? "Planned ETA after SLA" : Number.isFinite(plannedEta) ? "Within SLA plan" : "ETA unavailable";
  const serviceTime = deliveryKnown ? deliveredAt : plannedEta;
  const routes = [...new Map((detail.assignments ?? []).map((assignment) => [assignment.route.routeId, assignment.route])).values()];
  return <section className="optimization-panel contract-tracking-panel" aria-labelledby="tracking-title">
    <div className="panel-heading"><div><p className="eyebrow">ROUTE / SERVICE WINDOW</p><h2 id="tracking-title">Shipment tracking</h2></div><span className={`service-status${atRisk ? " is-risk" : ""}`}><i />{serviceLabel}</span></div>
    <div className="tracking-route-summary"><span className="route-origin">{routes[0]?.origin ?? "Route pending"}</span><span className="route-arrow" aria-hidden="true">→</span><span className="route-destination">{routes[0]?.destination ?? "Awaiting assignment"}</span>{routes.length > 1 && <small>+ {routes.length - 1} more routes</small>}</div>
    <ol className="shipment-milestones" aria-label={`Shipment milestones. Current milestone: ${delivered ? "Delivered" : lastStatus ? humanizeEvent(lastStatus) : "Awaiting dispatch"}`}>
      {stages.map((stage, index) => {
        const event = stage === "Delivered" ? delivery : shipmentEvents.find((item) => item.details?.status === stage);
        const complete = index <= stageIndex;
        const current = index === stageIndex && !delivered;
        return <li key={stage} className={`${complete ? "is-complete" : ""}${current ? " is-current" : ""}`}><span>{complete ? "✓" : String(index + 1).padStart(2, "0")}</span><strong>{stage === "CheckpointReached" ? "Checkpoint" : stage === "ArrivedAtDestination" ? "Destination" : stage}</strong><small>{event ? formatDate(event.timestamp) : complete ? "Recorded · awaiting event detail" : "Awaiting milestone"}</small></li>;
      })}
    </ol>
    <div className="tracking-service-window"><div><small>{deliveryKnown ? "ACTUAL DELIVERY" : "LATEST PLANNED ARRIVAL"}</small><strong>{Number.isFinite(serviceTime) ? formatDate(new Date(serviceTime!).toISOString()) : "Not available"}</strong></div><span aria-hidden="true">vs</span><div><small>CONTRACT SLA</small><strong>{detail.terms?.slaDeadline ? formatDate(detail.terms.slaDeadline) : "Not available"}</strong></div></div>
    <p className="tracking-footnote">Milestones are sourced from the contract event cache. The ETA is the latest immutable plan assignment, not a live location estimate.</p>
  </section>;
}

function SettlementBreakdown({ detail, history, redacted }: { detail: ContractDetail; history: ContractDetail["history"]; redacted: boolean }) {
  const penaltyEvent = [...(history ?? [])].reverse().find((event) => event.action === "PenaltyCalculated");
  const demurrageEvent = [...(history ?? [])].reverse().find((event) => event.action === "DemurrageCalculated");
  const secondsLate = numericDetail(penaltyEvent?.details?.secondsLate);
  const heldSeconds = numericDetail(demurrageEvent?.details?.heldSeconds);
  const blockSeconds = detail.terms?.penaltyBlockSeconds ?? 0;
  const penaltyBlocks = secondsLate === null || blockSeconds < 1 ? null : secondsLate === 0n ? 0n : (secondsLate - 1n) / BigInt(blockSeconds) + 1n;
  const freeSeconds = BigInt(detail.terms?.freeHoldingHours ?? 0) * 3600n;
  const billableHours = heldSeconds === null ? null : heldSeconds <= freeSeconds ? 0n : (heldSeconds - freeSeconds + 3599n) / 3600n;
  const computed = ["Delivered", "PenaltyCalculated", "PaymentReleased", "Closed", "Disputed"].includes(detail.state);
  const onHold = detail.state === "Disputed";
  const canExport = computed && /^\d+$/.test(detail.terms?.freightValuePaise ?? "") && /^\d+$/.test(detail.penaltyPaise ?? "") && /^\d+$/.test(detail.demurragePaise ?? "") && /^\d+$/.test(detail.netPaymentPaise ?? "");
  const capped = Boolean(detail.terms?.freightValuePaise && detail.penaltyPaise && /^\d+$/.test(detail.penaltyPaise) && detail.penaltyPaise === detail.terms.freightValuePaise && BigInt(detail.penaltyPaise) > 0n);
  return <section className="optimization-panel contract-settlement-panel" aria-labelledby="settlement-title">
    <div className="panel-heading"><div><p className="eyebrow">SETTLEMENT / INR PAISE SOURCE</p><h2 id="settlement-title">Settlement breakdown</h2></div><div className="settlement-tools"><span className={`settlement-state${onHold ? " is-hold" : ""}`}>{onHold ? "On hold · dispute" : computed ? detail.state === "PaymentReleased" || detail.state === "Closed" ? "Accounting release recorded" : "Calculation recorded" : "Awaiting delivery"}</span>{!redacted && <button className="secondary-button settlement-export-button" type="button" disabled={!canExport} onClick={() => downloadCsv(safeCsvFilename(detail.contractId, "settlement"), settlementCsv(detail))}>Export settlement CSV</button>}</div></div>
    {redacted ? <p className="redacted-inline">Commercial terms and settlement amounts are hidden for Administrator and Auditor views.</p> : <>
      {onHold && <p className="settlement-hold" role="status">A dispute is open. The recorded settlement remains on hold until it is resolved.</p>}
      {!computed && <p className="settlement-pending">The contract has not recorded a delivery calculation. Freight and deduction amounts will appear here when the backend reports them.</p>}
      <dl className="settlement-values"><Term label="Freight value" value={formatPaise(detail.terms?.freightValuePaise)} />
        <div className="settlement-line"><dt>Penalty<small>{penaltyBlocks === null ? "Calculation detail pending" : `${penaltyBlocks.toString()} ${penaltyBlocks === 1n ? "block" : "blocks"} × ${detail.terms?.penaltyBpsPerBlock ?? 0} BPS per ${formatDuration(blockSeconds)} block`}</small></dt><dd>{computed ? formatPaise(detail.penaltyPaise) : "Pending"}</dd></div>
        <div className="settlement-line"><dt>Demurrage<small>{billableHours === null ? "Calculation detail pending" : `${detail.terms?.wagonCount ?? 0} wagons × ${billableHours.toString()} billable ${billableHours === 1n ? "hour" : "hours"} × ${formatPaise(detail.terms?.demurrageRatePaisePerWagonHour)} per wagon-hour`}</small></dt><dd>{computed ? formatPaise(detail.demurragePaise) : "Pending"}</dd></div>
        <div className="settlement-net"><dt>{detail.state === "PaymentReleased" || detail.state === "Closed" ? "Net accounting value released" : "Net payable recorded by backend"}</dt><dd>{computed ? formatPaise(detail.netPaymentPaise) : "Pending"}</dd></div>
      </dl>
        {capped && <p className="settlement-cap">Penalty reached the freight value cap recorded by the contract.</p>}
      <p className="settlement-footnote">Amounts are returned by the contract API in integer paise and formatted here for display. This screen does not calculate settlement money.</p>
    </>}
  </section>;
}

function ContractTimeline({ state, currentIndex }: { state: ContractState; currentIndex: number }) {
  return <section className={`contract-timeline${state === "Disputed" ? " has-dispute" : ""}`} aria-label={`Contract lifecycle. Current state: ${STATE_LABEL[state]}`}><div className="timeline-caption"><span>STATE PROGRESSION</span><StateBadge state={state} /></div><ol>{FLOW.map((item, index) => <li key={item} className={`${index < currentIndex ? "is-complete" : ""}${index === currentIndex ? " is-current" : ""}`}><span className="timeline-node">{index < currentIndex ? "✓" : String(index + 1).padStart(2, "0")}</span><small>{STATE_LABEL[item]}</small></li>)}</ol>{state === "Disputed" && <div className="timeline-dispute"><span>!</span><strong>Dispute raised</strong><small>Settlement paused · resolution required</small></div>}</section>;
}

function StateBadge({ state }: { state: ContractState }) { return <span className={`contract-state-badge state-${state.toLowerCase()}`}><i />{STATE_LABEL[state]}</span>; }
function Term({ label, value, mono, emphasis }: { label: string; value: string; mono?: boolean; emphasis?: boolean }) { return <div className={`contract-term${mono ? " is-mono" : ""}${emphasis ? " is-emphasis" : ""}`}><dt>{label}</dt><dd>{value}</dd></div>; }

export function availableActions(state: ContractState, role?: string): ContractAction[] {
  const actions: ContractAction[] = [];
  if (role && isRole(role) && state === "Created" && hasPermission(role, "contracts.book")) actions.push("confirm-booking");
  if (role && isRole(role) && ["Booked", "InTransit"].includes(state) && hasPermission(role, "contracts.shipment")) actions.push("shipment-status");
  if (role && isRole(role) && state === "InTransit" && hasPermission(role, "contracts.delivery")) actions.push("confirm-delivery");
  if (role && isRole(role) && state === "PenaltyCalculated" && (role === "Shipper" || role === "Carrier") && hasPermission(role, "contracts.raiseDispute")) actions.push("dispute");
  if (role && isRole(role) && state === "Disputed" && hasPermission(role, "contracts.resolveDispute")) actions.push("resolve-dispute");
  if (role === "Administrator" && state === "PenaltyCalculated" && hasPermission(role, "contracts.resolveDispute")) actions.push("release-payment");
  if (role === "Administrator" && state === "PaymentReleased" && hasPermission(role, "contracts.resolveDispute")) actions.push("close");
  return actions;
}

function actionDescription(action: ContractAction) {
  const descriptions: Record<ContractAction, string> = {
    "confirm-booking": "The assigned Carrier will confirm this booking on the settlement contract.",
    "shipment-status": "Add a timestamped milestone to the immutable shipment record.",
    "confirm-delivery": "Confirm arrival with a proof-of-delivery reference and calculate the SLA deductions.",
    dispute: "Pause settlement and record a reason against this contract.",
    "resolve-dispute": "Choose the operator’s recorded outcome. The resolution returns the contract to penalty calculation.",
    "release-payment": "Record the accounting release after the dispute window; no assets move in this prototype.",
    close: "Close the released agreement on the settlement contract.",
  };
  return descriptions[action];
}

function actionIcon(action: ContractAction) { return ({ "confirm-booking": "✓", "shipment-status": "↗", "confirm-delivery": "▣", dispute: "!", "resolve-dispute": "⚖", "release-payment": "₹", close: "×" })[action]; }
function humanizeEvent(action: string) { return action.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/^./, (letter) => letter.toUpperCase()); }
function formatDate(value: string) { const parsed = Date.parse(value); return Number.isFinite(parsed) ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(parsed)) : "—"; }
function formatPaise(value?: string | null) {
  if (typeof value !== "string" || !/^-?\d+$/.test(value)) return "—";
  const amount = BigInt(value);
  const absolute = amount < 0n ? -amount : amount;
  const rupees = absolute / 100n;
  const paise = String(absolute % 100n).padStart(2, "0");
  return `${amount < 0n ? "−" : ""}₹${new Intl.NumberFormat("en-IN").format(rupees)}.${paise}`;
}
function numericDetail(value: unknown) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return null;
}
function formatDuration(seconds: number) {
  if (seconds > 0 && seconds % 86400 === 0) return `${seconds / 86400}-day`;
  if (seconds > 0 && seconds % 3600 === 0) return `${seconds / 3600}-hour`;
  if (seconds > 0 && seconds % 60 === 0) return `${seconds / 60}-minute`;
  return `${seconds}-second`;
}
