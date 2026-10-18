import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { acceptPlan, createOrder, runOptimization, type AcceptInput, type AllocationPlan, type OrderInput, type Weights } from "../api/optimization";
import { ApiError } from "../api/errors";
import { useAuth } from "../auth/context";
import { ErrorState, LoadingState } from "../components/StatePanel";

const INITIAL_WEIGHTS: Weights = { onTime: 0.5, cost: 0.3, utilization: 0.2 };
const REASONS: Record<string, string> = {
  NO_COMPATIBLE_WAGON: "No active wagon can carry this cargo type.",
  INCOMPATIBLE_WAGON_TYPE: "Available wagon types do not match this cargo.",
  NO_ROUTE: "There is no active route to this destination.",
  INSUFFICIENT_CAPACITY: "Available wagons do not have enough capacity.",
  NO_FEASIBLE_ASSIGNMENT: "No safe assignment met the current constraints.",
  TIME_BUDGET_EXCEEDED: "The solver reached its time limit before assigning this order.",
};

function defaultDeadline() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

export function OptimizationPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [weights, setWeights] = useState(INITIAL_WEIGHTS);
  const [plan, setPlan] = useState<AllocationPlan | null>(null);
  const [previous, setPrevious] = useState<AllocationPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingOrder, setPendingOrder] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orderNotice, setOrderNotice] = useState<string | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [emptyMessage, setEmptyMessage] = useState<string | null>(null);
  const [acceptanceNotice, setAcceptanceNotice] = useState<string | null>(null);
  const [acceptanceQueued, setAcceptanceQueued] = useState(false);
  const [carrierAddress, setCarrierAddress] = useState("");
  const [freightRupees, setFreightRupees] = useState("25000");
  const [penaltyBps, setPenaltyBps] = useState("100");
  const [penaltySeconds, setPenaltySeconds] = useState("3600");
  const [freeHoldingHours, setFreeHoldingHours] = useState("4");
  const [demurragePaise, setDemurragePaise] = useState("5000");
  const allowed = session?.user.role === "Shipper" || session?.user.role === "Administrator";
  const totalWeight = weights.onTime + weights.cost + weights.utilization;
  const shares = useMemo(() => totalWeight ? {
    onTime: weights.onTime / totalWeight,
    cost: weights.cost / totalWeight,
    utilization: weights.utilization / totalWeight,
  } : null, [weights, totalWeight]);
  const wagonCount = plan?.assignments.reduce((count, assignment) => count + assignment.wagonIds.length, 0) ?? 0;

  function updateWeight(key: keyof Weights, value: number) {
    setWeights((current) => ({ ...current, [key]: value }));
  }

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingOrder) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const input: OrderInput = {
      cargoType: String(form.get("cargoType") ?? "").trim(),
      quantityTonnes: Number(form.get("quantityTonnes")),
      destination: String(form.get("destination") ?? "").trim(),
      priority: Number(form.get("priority")),
      deadline: new Date(String(form.get("deadline"))).toISOString(),
    };
    setPendingOrder(true); setOrderError(null); setOrderNotice(null);
    try {
      const result = await createOrder(input);
      setOrderNotice(`Order ${result.orderId} is in the queue. Run an allocation when you’re ready.`);
      formElement.reset();
    } catch (cause) {
      setOrderError(cause instanceof ApiError ? cause.message : "Order could not be submitted. Try again.");
    } finally { setPendingOrder(false); }
  }

  async function run() {
    if (busy || totalWeight <= 0) return;
    setBusy(true); setError(null); setEmptyMessage(null);
    try {
      const result = await runOptimization(shares ?? weights);
      if ("status" in result && result.status === "empty") {
        setEmptyMessage(result.message); setPrevious(plan); setPlan(null);
      } else {
        setPrevious(plan); setPlan(result as AllocationPlan);
      }
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 503) setError("Track 1’s optimization service is unavailable. Orders can still be submitted above; try the run again when the engine is back.");
      else setError(cause instanceof Error ? cause.message : "The allocation run could not be completed.");
    } finally { setBusy(false); }
  }

  async function accept() {
    if (!plan || accepting) return;
    const carrier = carrierAddress.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(carrier)) { setError("Enter the carrier’s 42-character wallet address, starting with 0x."); return; }
    const freight = Math.round(Number(freightRupees) * 100);
    if (!Number.isSafeInteger(freight) || freight < 1) { setError("Enter a valid freight value in rupees."); return; }
    setAccepting(true); setError(null);
    const body: AcceptInput = {
      carrierAddress: carrier,
      terms: {
        freightValuePaise: String(freight),
        penaltyBpsPerBlock: Number(penaltyBps),
        penaltyBlockSeconds: Number(penaltySeconds),
        freeHoldingHours: Number(freeHoldingHours),
        demurrageRatePaisePerWagonHour: String(Math.max(0, Math.round(Number(demurragePaise)))),
        wagonCount,
      },
    };
    try {
      const result = await acceptPlan(plan.planId, body);
      if ("status" in result && result.status === "queued") {
        setAcceptanceQueued(true);
        setAcceptanceNotice(`${result.message} Agreement operation ${result.operationId}. Check again here; repeating this request is safe.`);
      } else {
        const accepted = result as import("../api/optimization").ContractAcceptance;
        navigate(`/contracts/${encodeURIComponent(accepted.contractId)}`, { state: { acceptance: accepted } });
      }
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "The contract could not be created. Your plan is still available; review the terms and retry.");
    } finally { setAccepting(false); }
  }

  if (!allowed) return <ErrorState title="Allocation access required"><p>This workflow is available to Shipper and Administrator accounts.</p><Link className="text-link" to="/overview">Return to overview <span aria-hidden="true">↗</span></Link></ErrorState>;

  return <section className="optimization-page" aria-labelledby="optimization-title">
    <header className="overview-heading optimization-heading">
      <div><p className="eyebrow"><span className="eyebrow-mark" /> WORKSHOP / ALLOCATION</p><h1 id="optimization-title">Set the freight in motion.</h1><p className="overview-intro">Shape the trade-offs, run the yard, then choose the plan that fits.</p></div>
      <span className="optimization-ticket">TRACK 1 <i>↗</i></span>
    </header>

    <section className="optimization-panel order-panel" aria-labelledby="new-order-title">
      <div className="panel-heading"><div><p className="eyebrow">FIRST, THE LOAD</p><h2 id="new-order-title">Add a freight order</h2></div><span className="optimization-step">01</span></div>
      <form className="freight-order-form" onSubmit={submitOrder}>
        <label>Cargo type<input name="cargoType" placeholder="e.g. grain" required maxLength={128} /></label>
        <label>Quantity <span className="unit">tonnes</span><input name="quantityTonnes" type="number" min="0.001" step="0.001" placeholder="40" required /></label>
        <label>Destination<input name="destination" placeholder="e.g. Port-A" required maxLength={256} /></label>
        <label>Priority<select name="priority" defaultValue="2"><option value="1">Urgent</option><option value="2">Standard</option><option value="3">Flexible</option></select></label>
        <label>Required by<input name="deadline" type="datetime-local" min={defaultDeadline()} defaultValue={defaultDeadline()} required /></label>
        <button className="primary-button" disabled={pendingOrder} type="submit">{pendingOrder ? "Submitting…" : "Queue order"}<span aria-hidden="true"> ↗</span></button>
      </form>
      {orderNotice && <p className="optimization-notice" role="status">{orderNotice}</p>}
      {orderError && <p className="form-error" role="alert">{orderError}</p>}
    </section>

    <section className="optimization-panel weight-panel" aria-labelledby="weight-title">
      <div className="panel-heading"><div><p className="eyebrow">THE TRADE-OFF</p><h2 id="weight-title">Tune the priorities</h2></div><span className="optimization-step">02</span></div>
      <p className="optimization-copy">Drag the markers to rebalance what matters. The live shares below show each objective’s influence after normalization.</p>
      <div className="weight-controls">
        <WeightControl id="on-time" label="On-time delivery" value={weights.onTime} share={shares?.onTime ?? 0} onChange={(v) => updateWeight("onTime", v)} icon="◷" />
        <WeightControl id="cost" label="Freight cost" value={weights.cost} share={shares?.cost ?? 0} onChange={(v) => updateWeight("cost", v)} icon="₹" />
        <WeightControl id="utilization" label="Wagon utilization" value={weights.utilization} share={shares?.utilization ?? 0} onChange={(v) => updateWeight("utilization", v)} icon="▤" />
      </div>
      {!shares && <p className="form-error" role="alert">At least one priority must be above zero.</p>}
      <div className="weight-bar" aria-label={shares ? `Normalized weights: on-time ${Math.round(shares.onTime * 100)}%, cost ${Math.round(shares.cost * 100)}%, utilization ${Math.round(shares.utilization * 100)}%` : "Weights total zero"}>
        <span style={{ width: `${(shares?.onTime ?? 0) * 100}%` }} /><span style={{ width: `${(shares?.cost ?? 0) * 100}%` }} /><span style={{ width: `${(shares?.utilization ?? 0) * 100}%` }} />
      </div>
      <div className="optimization-run-row"><div><strong>Every run keeps its own plan.</strong><small>Pending orders are locked into the saved result.</small></div><button className="primary-button run-button" disabled={busy || !shares} onClick={() => void run()} type="button">{busy ? <><span className="loading-mark" /> Finding a route…</> : <>{plan ? "Run what-if" : "Run allocation"}<span aria-hidden="true"> ↗</span></>}</button></div>
      {busy && <div className="run-progress" role="status"><span /><div><strong>Searching the active yard</strong><small>Comparing routes, capacity, and delivery windows.</small></div></div>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {emptyMessage && <div className="optimization-empty" role="status"><strong>No pending orders reached the optimizer.</strong><p>{emptyMessage}</p><span>Orders already submitted remain available in your order queue.</span></div>}
    </section>

    {plan && <PlanResult plan={plan} previous={previous} carrierAddress={carrierAddress} setCarrierAddress={setCarrierAddress} freightRupees={freightRupees} setFreightRupees={setFreightRupees} penaltyBps={penaltyBps} setPenaltyBps={setPenaltyBps} penaltySeconds={penaltySeconds} setPenaltySeconds={setPenaltySeconds} freeHoldingHours={freeHoldingHours} setFreeHoldingHours={setFreeHoldingHours} demurragePaise={demurragePaise} setDemurragePaise={setDemurragePaise} wagonCount={wagonCount} onAccept={() => void accept()} accepting={accepting} acceptanceNotice={acceptanceNotice} acceptanceQueued={acceptanceQueued} />}
    {busy && !plan && <div className="optimization-first-run"><LoadingState label="Finding a route through the yard…" /></div>}
  </section>;
}

function WeightControl({ id, label, value, share, onChange, icon }: { id: string; label: string; value: number; share: number; onChange: (value: number) => void; icon: string }) {
  return <label className="weight-control" htmlFor={`weight-${id}`}><span className="weight-control-top"><span className="weight-icon" aria-hidden="true">{icon}</span><span>{label}</span><strong>{Math.round(share * 100)}<small>%</small></strong></span><input id={`weight-${id}`} aria-label={`${label} weight`} type="range" min="0" max="1" step="0.05" value={value} onChange={(event) => onChange(Number(event.target.value))} /><span className="weight-control-bottom"><small>Influence</small><small>Dial weight {value.toFixed(2)}</small></span></label>;
}

function PlanResult({ plan, previous, carrierAddress, setCarrierAddress, freightRupees, setFreightRupees, penaltyBps, setPenaltyBps, penaltySeconds, setPenaltySeconds, freeHoldingHours, setFreeHoldingHours, demurragePaise, setDemurragePaise, wagonCount, onAccept, accepting, acceptanceNotice, acceptanceQueued }: {
  plan: AllocationPlan; previous: AllocationPlan | null; carrierAddress: string; setCarrierAddress: (value: string) => void; freightRupees: string; setFreightRupees: (value: string) => void; penaltyBps: string; setPenaltyBps: (value: string) => void; penaltySeconds: string; setPenaltySeconds: (value: string) => void; freeHoldingHours: string; setFreeHoldingHours: (value: string) => void; demurragePaise: string; setDemurragePaise: (value: string) => void; wagonCount: number; onAccept: () => void; accepting: boolean; acceptanceNotice: string | null; acceptanceQueued: boolean;
}) {
  const metrics = plan.metrics;
  const changed = previous ? [
    { label: "Estimated cost", value: formatRupees(metrics.estimatedCostPaise), before: formatRupees(previous.metrics.estimatedCostPaise) },
    { label: "On-time probability", value: formatPercent(metrics.onTimeProbability), before: formatPercent(previous.metrics.onTimeProbability) },
  ] : [];
  return <section className="plan-result" aria-labelledby="plan-result-title">
    <header className="plan-result-header"><div><p className="eyebrow">03 / THE RESULT · {plan.runMetadata.algorithm}</p><h2 id="plan-result-title">{plan.assignments.length ? "A route worth taking." : "No wagons assigned."}</h2><p>Plan {plan.planId} · {new Date(plan.runMetadata.generatedAt).toLocaleString()} · {plan.runMetadata.durationMs} ms</p></div><span className="plan-score"><small>PLAN SCORE</small><strong>{plan.score.toFixed(2)}</strong></span></header>
    <div className="plan-kpis" aria-label="Plan performance metrics">
      <Metric label="Wagon utilization" value={`${metrics.utilizationPercent.toFixed(1)}%`} mark="▤" />
      <Metric label="Estimated cost" value={formatRupees(metrics.estimatedCostPaise)} mark="₹" />
      <Metric label="Route distance" value={`${metrics.distanceKm.toLocaleString()} km`} mark="↗" />
      <Metric label="On-time chance" value={formatPercent(metrics.onTimeProbability)} mark="◷" />
    </div>
    {previous && <div className="what-if-comparison" aria-live="polite"><strong>Changed from the previous run</strong>{changed.map((item) => <span key={item.label}>{item.label}: <b>{item.before}</b><i aria-hidden="true">→</i><b>{item.value}</b></span>)}</div>}
    <div className="plan-result-grid">
      <section className="optimization-panel assignment-panel"><div className="panel-heading"><div><p className="eyebrow">WAGON SHEET</p><h3>Assignments</h3></div><span className="panel-count">{plan.assignments.length} loads</span></div>
        {plan.assignments.length === 0 ? <div className="optimization-empty"><strong>Nothing could be moved on this run.</strong><p>Review the unassigned reasons below or adjust the objective weights and run again.</p></div> : <div className="assignment-table-wrap"><table className="assignment-table"><thead><tr><th>Order / cargo</th><th>Wagons</th><th>Route</th><th>ETA</th><th>On time</th></tr></thead><tbody>{plan.assignments.map((assignment) => <tr key={assignment.orderId}><td><strong>{assignment.orderId}</strong><small>{assignment.quantityTonnes} t · {assignment.cargoType}</small></td><td>{assignment.wagonIds.join(", ")}</td><td><strong>{assignment.route.origin} → {assignment.route.destination}</strong><small>{assignment.route.routeId}</small></td><td>{new Date(assignment.eta).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</td><td><span className="assignment-probability">{formatPercent(assignment.onTimeProbability)}</span></td></tr>)}</tbody></table></div>}
      </section>
      {plan.unassignedOrders.length > 0 && <section className="optimization-panel unassigned-panel"><div className="panel-heading"><div><p className="eyebrow">LEFT IN THE YARD</p><h3>Unassigned orders</h3></div><span className="alert-count">{plan.unassignedOrders.length}</span></div><ul>{plan.unassignedOrders.map((order) => <li key={order.orderId}><strong>{order.orderId}</strong><p>{REASONS[order.reasonCode] ?? order.message}</p></li>)}</ul></section>}
      {plan.alternatives.length > 0 && <section className="optimization-panel alternatives-panel"><div className="panel-heading"><div><p className="eyebrow">OTHER ROUTES</p><h3>Ranked alternatives</h3></div><span className="panel-count">{plan.alternatives.length} options</span></div><div className="alternatives-list">{plan.alternatives.map((alternative) => <article key={alternative.rank}><span>ALT {String(alternative.rank).padStart(2, "0")}</span><strong>{alternative.assignments.length} loads · {formatRupees(alternative.metrics.estimatedCostPaise)}</strong><small>{alternative.metrics.distanceKm.toLocaleString()} km · {formatPercent(alternative.metrics.onTimeProbability)} on-time</small></article>)}</div></section>}
      {plan.assignments.length > 0 && <section className="optimization-panel accept-panel"><div className="panel-heading"><div><p className="eyebrow">04 / ACCEPT THIS PLAN</p><h3>Make it an agreement</h3></div><span className="optimization-step">↗</span></div><p className="optimization-copy">Acceptance creates a Track 2 contract. Enter a registered carrier wallet and commercial terms; wagon count is locked to this plan.</p><div className="contract-terms-form">
        <label className="terms-wide">Carrier wallet address<input value={carrierAddress} onChange={(event) => setCarrierAddress(event.target.value)} placeholder="0x… · 42 characters" autoComplete="off" /></label>
        <label>Freight value <small>INR</small><input type="number" min="0.01" step="0.01" value={freightRupees} onChange={(event) => setFreightRupees(event.target.value)} /></label>
        <label>Penalty per block <small>BPS</small><input type="number" min="0" max="65535" step="1" value={penaltyBps} onChange={(event) => setPenaltyBps(event.target.value)} /></label>
        <label>Block duration <small>seconds</small><input type="number" min="1" step="1" value={penaltySeconds} onChange={(event) => setPenaltySeconds(event.target.value)} /></label>
        <label>Free holding <small>hours</small><input type="number" min="0" step="1" value={freeHoldingHours} onChange={(event) => setFreeHoldingHours(event.target.value)} /></label>
        <label>Demurrage <small>paise / wagon / hour</small><input type="number" min="0" step="1" value={demurragePaise} onChange={(event) => setDemurragePaise(event.target.value)} /></label>
        <div className="terms-derived"><span>Locked wagons<strong>{wagonCount}</strong></span><span>Plan<small>{plan.planId}</small></span></div>
      </div>{acceptanceNotice && <p className="optimization-notice" role="status">{acceptanceNotice}</p>}<button className="primary-button accept-button" disabled={accepting} onClick={onAccept} type="button">{accepting ? "Creating agreement…" : acceptanceQueued ? "Check agreement status" : "Accept & create contract"}<span aria-hidden="true"> ↗</span></button><p className="accept-footnote">The Shipper wallet and SLA deadline come from the saved plan. A repeated request is idempotent.</p></section>}
    </div>
  </section>;
}

function Metric({ label, value, mark }: { label: string; value: string; mark: string }) { return <article className="plan-metric"><span aria-hidden="true">{mark}</span><small>{label}</small><strong>{value}</strong></article>; }
function formatPercent(value: number) { return `${(value * 100).toFixed(1)}%`; }
function formatRupees(paise: string) { const amount = Number(paise) / 100; return Number.isFinite(amount) ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount) : "—"; }
