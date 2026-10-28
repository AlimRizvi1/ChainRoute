import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { auditEntries, savedPlans, type AuditEntry, type Page, type SavedPlan } from "../api/platform";
import { LoadingState } from "../components/StatePanel";
import "./platform.css";

export function SavedPlansPage() {
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<Page<SavedPlan> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { let active = true; setData(null); setError(""); void savedPlans(offset).then(result => { if (active) setData(result); }).catch(cause => { if (active) setError(cause.message); }); return () => { active = false; }; }, [offset, revision]);
  return <section className="records-page"><header className="overview-heading"><div><h1>Plans that stay with you.</h1><p className="overview-intro">Reopen saved allocation runs, compare a what-if scenario, or continue to the freight agreement.</p></div><Link className="primary-button" to="/allocations">New allocation</Link></header>
    {error && <p className="form-error" role="alert">{error} <button type="button" onClick={() => setRevision(value => value + 1)}>Retry</button></p>}
    {!data && !error && <LoadingState label="Loading saved plans…" />}
    {data && <><div className="records-table-wrap" tabIndex={0} role="region" aria-label="Scrollable data table"><table className="records-table"><thead><tr><th>Saved run</th><th>Loads</th><th>On-time chance</th><th>Estimated cost</th><th>Continue</th></tr></thead><tbody>{data.items.map(plan => <tr key={plan.planId}><td><strong>{new Date(plan.createdAt).toLocaleString()}</strong><code>{plan.planId}</code></td><td>{plan.assignmentCount}</td><td>{(plan.metrics.onTimeProbability * 100).toFixed(1)}%</td><td>{new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(Number(plan.metrics.estimatedCostPaise) / 100)}</td><td><Link to={`/allocations?plan=${encodeURIComponent(plan.planId)}`}>Open plan</Link>{plan.contractId && <Link to={`/contracts/${encodeURIComponent(plan.contractId)}`}>View contract</Link>}</td></tr>)}</tbody></table></div>{data.items.length === 0 && <div className="records-empty"><h2>No saved plans yet.</h2><p>Add a freight order, then run an allocation. The result will be saved here automatically.</p><Link to="/orders">Open freight orders</Link></div>}<Pagination offset={offset} next={data.nextOffset} total={data.total} onChange={setOffset} /></>}
  </section>;
}

export function AuditPage() {
  const [offset, setOffset] = useState(0);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [outcome, setOutcome] = useState("");
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<Page<AuditEntry> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { let active = true; setData(null); setError(""); void auditEntries(offset, search, outcome).then(result => { if (active) setData(result); }).catch(cause => { if (active) setError(cause.message); }); return () => { active = false; }; }, [offset, search, outcome, revision]);
  function filter(event: FormEvent) { event.preventDefault(); setOffset(0); setSearch(draft.trim()); setRevision(value => value + 1); }
  return <section className="records-page"><header className="overview-heading"><div><h1>Every action, accounted for.</h1><p className="overview-intro">Review who submitted an action and whether the API accepted it. Blockchain events remain in each contract’s timeline.</p></div><Link className="secondary-button" to="/blockchain">Explore the blockchain</Link></header>
    <form className="records-filter" onSubmit={filter}><label>Actor or action<input value={draft} maxLength={128} onChange={event => setDraft(event.target.value)} placeholder="e.g. contracts.delivery" /></label><label>Outcome<select value={outcome} onChange={event => { setOutcome(event.target.value); setOffset(0); }}><option value="">All outcomes</option><option value="success">Accepted</option><option value="failure">Rejected</option></select></label><button type="submit" className="primary-button">Search audit</button></form>
    {error && <p className="form-error" role="alert">{error} <button type="button" onClick={() => setRevision(value => value + 1)}>Retry</button></p>}
    {!data && !error && <LoadingState label="Reading the audit trail…" />}
    {data && <><div className="records-table-wrap" tabIndex={0} role="region" aria-label="Scrollable data table"><table className="records-table"><thead><tr><th>Time</th><th>Actor</th><th>Action / resource</th><th>Result</th></tr></thead><tbody>{data.items.map(entry => <tr key={entry.id}><td><time dateTime={entry.occurredAt}>{new Date(entry.occurredAt).toLocaleString()}</time></td><td>{entry.actor}</td><td><strong>{entry.action}</strong><code>{entry.resourceType}{entry.resourceId ? ` / ${entry.resourceId}` : ""}</code></td><td><span className={`audit-outcome ${entry.outcome}`}>{entry.outcome === "success" ? "Accepted" : "Rejected"}</span><small>HTTP {entry.statusCode}</small></td></tr>)}</tbody></table></div>{!data.items.length && <p className="records-empty">No audit entries match this filter.</p>}<Pagination offset={offset} next={data.nextOffset} total={data.total} onChange={setOffset} /></>}
  </section>;
}
function Pagination({ offset, next, total, onChange }: { offset: number; next: number | null; total: number; onChange: (offset: number) => void }) { return <div className="records-pagination"><span>{total} records{total > 0 ? ` · showing ${offset + 1}–${Math.min(offset + 25, total)}` : ""}</span><button type="button" className="secondary-button" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - 25))}>Previous</button><button type="button" className="secondary-button" disabled={next === null} onClick={() => onChange(next!)}>Next</button></div>; }
