import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { getOverview, type OverviewData } from "../api/overview";
import { useAuth } from "../auth/context";
import { hasPermission } from "../auth/roles";
import { EmptyState, ErrorState, LoadingState } from "../components/StatePanel";

const ACTIVE = new Set(["Created", "Booked", "InTransit", "Disputed"]);
const SHIPMENTS = new Set(["InTransit"]);

export function OverviewPage() {
  const { session } = useAuth();
  const role = session?.user.role;
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);

  const refresh = useCallback(async (background = false) => {
    if (!role) return;
    background ? setRefreshing(true) : setLoading(true);
    setFatalError(null);
    try {
      setData(await getOverview(role));
    } catch (error) {
      setFatalError(error instanceof Error ? error.message : "The overview could not be loaded.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [role]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(true), 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const handleContractEvent = () => void refresh(true);
    window.addEventListener("chainroute:contract-event", handleContractEvent);
    return () => window.removeEventListener("chainroute:contract-event", handleContractEvent);
  }, [refresh]);

  if (loading && !data) return <LoadingState label="Bringing the network into view…" />;
  if (fatalError && !data) return <ErrorState title="Overview unavailable" action={<button className="secondary-button" onClick={() => void refresh()} type="button">Try again</button>}><p>{fatalError}</p></ErrorState>;
  if (!data || !role) return null;

  const maySeeSummary = hasPermission(role, "dashboard.summary");
  const activeContracts = data.contracts.filter((contract) => ACTIVE.has(contract.state));
  const shipments = activeContracts.filter((contract) => SHIPMENTS.has(contract.state));
  const alerts = data.contracts.filter((contract) => contract.state === "Disputed" || (contract.slaDeadline && Date.parse(contract.slaDeadline) < Date.now() && ACTIVE.has(contract.state)));
  const todayLabel = `${new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date())} · UTC`;

  return (
    <section className="overview-page" aria-labelledby="overview-title">
      <header className="overview-heading">
        <div>
          <p className="eyebrow"><span className="eyebrow-mark" /> NETWORK / {todayLabel.toUpperCase()}</p>
          <h1 id="overview-title">Freight, in motion.</h1>
          <p className="overview-intro">A live read on orders, wagons, contracts, and the work that needs attention.</p>
        </div>
        <button className="overview-refresh" onClick={() => void refresh(true)} disabled={refreshing} type="button">
          <span className={refreshing ? "refresh-glyph is-spinning" : "refresh-glyph"} aria-hidden="true">↻</span>
          {refreshing ? "Updating" : "Refresh"}
        </button>
      </header>

      {data.sampleData && <p className="overview-sample" role="status"><span aria-hidden="true">✳</span> Sample network · synthetic activity, refreshed every 15 seconds</p>}
      {data.summaryError && <div className="summary-error-strip" role="status">Some metrics could not refresh. Contract activity remains available. <button type="button" onClick={() => void refresh(true)}>Retry summary</button></div>}
      {fatalError && <div className="overview-inline-error" role="alert">Live refresh failed: {fatalError} <button type="button" onClick={() => void refresh(true)}>Retry</button></div>}

      <div className="overview-kpis" aria-label="Network key performance indicators">
        <KpiCard number={maySeeSummary ? data.summary.pendingOrders : null} label="Orders in queue" detail={maySeeSummary ? "Ready for allocation" : "Outside this role’s scope"} accent="tomato" icon="↗" />
        <KpiCard number={maySeeSummary ? `${data.summary.wagonUtilizationPercent}%` : null} label="Wagon utilization" detail={maySeeSummary ? `${data.summary.allocationsToday} allocations today` : "Operational summary"} accent="sun" icon="▤" />
        <KpiCard number={data.summary.activeContracts} label="Active contracts" detail={`${shipments.length} currently in transit`} accent="navy" icon="⇢" />
        <KpiCard number={data.summary.pendingPayments} label="Settlement queue" detail="Awaiting review or release" accent="cream" icon="◷" />
      </div>

      <div className="overview-grid">
        <section className="overview-panel journey-panel" aria-labelledby="journey-title">
          <div className="panel-heading">
            <div><p className="eyebrow">LIVE MOVEMENT</p><h2 id="journey-title">Across the network</h2></div>
            <span className="panel-count"><i /> {shipments.length} in transit</span>
          </div>
          {data.contractsError ? <ErrorState title="Movement unavailable" action={<button className="secondary-button" onClick={() => void refresh(true)} type="button">Try again</button>}><p>{data.contractsError}</p></ErrorState> : shipments.length === 0 ? (
            <EmptyState title="No shipments moving yet"><p>Accepted plans will appear here as carriers dispatch them.</p><Link className="text-link" to="/allocations">Open allocations <span aria-hidden="true">↗</span></Link></EmptyState>
          ) : <JourneyMap shipments={shipments} />}
          {!data.contractsError && shipments.length > 0 && <div className="shipment-strip">
            {shipments.slice(0, 4).map((contract, index) => <div className="shipment-item" key={contract.contractId} style={{ "--item-index": index } as React.CSSProperties}>
              <span className="shipment-route-mark" aria-hidden="true">{index + 1}</span>
              <span><strong>Contract {contract.contractId}</strong><small>{contract.state === "InTransit" ? "On the line · tracking live" : contract.state}</small></span>
              <span className="shipment-state">IN TRANSIT</span>
            </div>)}
          </div>}
        </section>

        <section className="overview-panel activity-panel" aria-labelledby="activity-title">
          <div className="panel-heading">
            <div><p className="eyebrow">ALLOCATION PULSE</p><h2 id="activity-title">The week's rhythm</h2></div>
            <span className="chart-period">7 DAYS</span>
          </div>
          {maySeeSummary ? <UtilizationChart values={data.summary.utilizationTrend} /> : <div className="chart-private"><span className="chart-private-mark" aria-hidden="true">↗</span><strong>Network activity stays in view.</strong><p>Personal allocation metrics are scoped to Shipper and Administrator accounts.</p></div>}
          {maySeeSummary && <div className="activity-footer"><span>Wagon utilization</span><strong>{data.summary.wagonUtilizationPercent}% <small>today</small></strong></div>}
        </section>

        <section className="overview-panel alerts-panel" aria-labelledby="alerts-title">
          <div className="panel-heading">
            <div><p className="eyebrow">NEEDS A LOOK</p><h2 id="alerts-title">Signal board</h2></div>
            <span className="alert-count">{alerts.length.toString().padStart(2, "0")}</span>
          </div>
          {data.contractsError ? <ErrorState title="Alerts unavailable" action={<button className="secondary-button" onClick={() => void refresh(true)} type="button">Try again</button>}><p>{data.contractsError}</p></ErrorState> : alerts.length === 0 ? <div className="all-clear"><span aria-hidden="true">✳</span><div><strong>All clear on this run.</strong><small>No active disputes or overdue contracts.</small></div></div> : <ul className="alert-list">
            {alerts.slice(0, 5).map((contract, index) => <li key={contract.contractId} className={contract.state === "Disputed" ? "alert-row alert-dispute" : "alert-row alert-delay"}>
              <span className="alert-symbol" aria-hidden="true">{contract.state === "Disputed" ? "!" : "↘"}</span>
              <span><strong>{contract.state === "Disputed" ? "Dispute needs review" : "SLA deadline passed"}</strong><small>Contract {contract.contractId}</small></span>
              <Link to="/contracts" aria-label={`Review contract ${contract.contractId}`} className="alert-link" style={{ "--item-index": index } as React.CSSProperties}>↗</Link>
            </li>)}
          </ul>}
          <Link to="/contracts" className="panel-link">View contracts <span aria-hidden="true">→</span></Link>
        </section>

        <section className="overview-bottom-callout" aria-label="Next step">
          <span className="callout-stamp" aria-hidden="true">CR</span>
          <div><p className="eyebrow">KEEP THE FREIGHT MOVING</p><strong>{maySeeSummary && data.summary.pendingOrders > 0 ? `${data.summary.pendingOrders} orders are ready for a plan.` : "Every handoff leaves a clear trail."}</strong></div>
          <Link to={maySeeSummary ? "/allocations" : "/contracts"} className="callout-link">{maySeeSummary ? "Build an allocation" : "Follow a contract"}<span aria-hidden="true">↗</span></Link>
        </section>
      </div>
    </section>
  );
}

function KpiCard({ number, label, detail, accent, icon }: { number: number | string | null; label: string; detail: string; accent: string; icon: string }) {
  return <article className={`overview-kpi kpi-${accent}`}>
    <span className="kpi-icon" aria-hidden="true">{icon}</span>
    <p>{label}</p>
    <strong>{number === null ? "—" : number}</strong>
    <small>{detail}</small>
    <span className="kpi-spark" aria-hidden="true" />
  </article>;
}

function JourneyMap({ shipments }: { shipments: OverviewData["contracts"] }) {
  const positions = useMemo(() => shipments.slice(0, 7).map((contract, index) => ({ contract, x: 358, y: 58 + index * 17 })), [shipments]);
  return <div className="journey-map-wrap">
    <svg className="journey-map" viewBox="0 0 720 186" role="img" aria-label={`${shipments.length} shipment${shipments.length === 1 ? "" : "s"} moving through the dispatch, checkpoint, and arrival stages`}>
      <defs><pattern id="route-grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#1b2a52" opacity=".16" /></pattern></defs>
      <rect width="720" height="186" rx="12" fill="url(#route-grid)" />
      <path className="route-backline" d="M48 99 C145 19 211 162 314 94 S487 31 672 105" />
      <path className="route-line" pathLength="1" d="M48 99 C145 19 211 162 314 94 S487 31 672 105" />
      {[{ x: 56, label: "DISPATCH" }, { x: 257, label: "CHECKPOINT" }, { x: 459, label: "TRANSFER" }, { x: 664, label: "ARRIVAL" }].map((point) => <g key={point.label} className="route-stop"><circle cx={point.x} cy={point.label === "DISPATCH" ? 99 : point.label === "CHECKPOINT" ? 102 : point.label === "TRANSFER" ? 77 : 105} r="7" /><text x={point.x} y="156" textAnchor="middle">{point.label}</text></g>)}
      {positions.map(({ contract, x, y }, index) => <g key={contract.contractId} className="route-token" style={{ "--item-index": index } as React.CSSProperties}>
        <circle className="route-token-halo" cx={x} cy={y} r="12" /><circle className="route-token-dot" cx={x} cy={y} r="5" /><title>Contract {contract.contractId}, in transit</title>
      </g>)}
      <text x="20" y="22" className="map-label">RAIL MOVEMENT / SCHEMATIC</text>
    </svg>
    <p className="map-caption"><span className="map-live-dot" /> Schematic lifecycle · each token marks a confirmed in-transit contract</p>
  </div>;
}

function UtilizationChart({ values }: { values: number[] }) {
  const normalized = values.length === 7 ? values : [0, 0, 0, 0, 0, 0, 0];
  const points = normalized.map((value, index) => `${34 + index * 54},${116 - value * 0.82}`).join(" ");
  const area = `34,116 ${points} 358,116`;
  const today = new Date();
  const labels = Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat("en", { weekday: "narrow", timeZone: "UTC" }).format(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 6 + index))));
  return <div className="utilization-chart">
    <svg viewBox="0 0 390 146" role="img" aria-label={`Wagon utilization trend for the last seven days: ${normalized.join(", ")} percent`}>
      {[0, 25, 50, 75, 100].map((value) => <g key={value}><line x1="30" x2="370" y1={116 - value * 0.82} y2={116 - value * 0.82} /><text x="5" y={120 - value * 0.82}>{value}</text></g>)}
      <polygon points={area} className="chart-area" />
      <polyline points={points} className="chart-line" />
      {normalized.map((value, index) => <circle key={index} cx={34 + index * 54} cy={116 - value * 0.82} r="4" className="chart-point"><title>{value}% utilization</title></circle>)}
      {labels.map((label, index) => <text key={index} x={34 + index * 54} y="139" textAnchor="middle" className="chart-day">{label}</text>)}
    </svg>
  </div>;
}
