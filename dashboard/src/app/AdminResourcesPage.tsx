import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { getRoutes, getWagons, saveResource, type FreightRoute, type Wagon } from "../api/platform";
import { LoadingState } from "../components/StatePanel";
import "./platform.css";

const newWagon = (): Wagon => ({ wagonId: "", capacityTonnes: 60, wagonType: "covered", location: "", available: true, active: true });
const newRoute = (): FreightRoute => ({ routeId: "", origin: "", destination: "", distanceKm: 100, transitTimeSeconds: 3600, active: true });
export function AdminResourcesPage() {
  const [kind, setKind] = useState<"wagons" | "routes">("wagons");
  const [wagons, setWagons] = useState<Wagon[]>([]);
  const [routes, setRoutes] = useState<FreightRoute[]>([]);
  const [wagon, setWagon] = useState(newWagon);
  const [route, setRoute] = useState(newRoute);
  const [editing, setEditing] = useState(false);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => { let active = true; void Promise.all([getWagons(), getRoutes()]).then(([w, r]) => { if (active) { setWagons(w.items); setRoutes(r.items); setError(""); } }).catch(cause => { if (active) setError(cause.message); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [revision]);
  async function save(event: FormEvent) { event.preventDefault(); if (busy) return; setBusy(true); setError(""); setNotice(""); try { await saveResource(kind, kind === "wagons" ? wagon : route); setNotice(`${kind === "wagons" ? wagon.wagonId : route.routeId} saved. New allocations use the updated yard; existing plans retain their snapshots.`); setEditing(true); setRevision(value => value + 1); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save the resource."); } finally { setBusy(false); } }
  function reset() { setWagon(newWagon()); setRoute(newRoute()); setEditing(false); setNotice(""); }
  const text = filter.toLowerCase();
  return <section className="records-page"><header className="overview-heading"><div><h1>Keep the yard ready.</h1><p className="overview-intro">Maintain the wagons and routes that the allocator can use. Disable a resource to exclude it from future runs.</p></div><Link className="secondary-button" to="/admin">People & access</Link></header>
    <div className="resource-switch" role="group" aria-label="Resource type">{(["wagons", "routes"] as const).map(value => <button type="button" className={kind === value ? "primary-button" : "secondary-button"} aria-pressed={kind === value} key={value} onClick={() => { setKind(value); reset(); }}>{value === "wagons" ? "Wagons" : "Routes"}</button>)}</div>
    {error && <p className="form-error" role="alert">{error} <button type="button" onClick={() => setRevision(value => value + 1)}>Reload</button></p>}{notice && <p className="form-notice" role="status">{notice}</p>}
    <section className="resource-editor"><h2>{editing ? "Edit" : "Add"} {kind === "wagons" ? "wagon" : "route"}</h2><form onSubmit={event => void save(event)} className="resource-form">
      {kind === "wagons" ? <>
        <label>Wagon ID<input required maxLength={128} disabled={editing} value={wagon.wagonId} onChange={event => setWagon({ ...wagon, wagonId: event.target.value.trim() })} /></label>
        <label>Type<select value={wagon.wagonType} onChange={event => setWagon({ ...wagon, wagonType: event.target.value })}>{Array.from(new Set(["covered", "open", "flat", "tank", ...wagons.map(item => item.wagonType)])).map(type => <option key={type}>{type}</option>)}</select></label>
        <label>Capacity (tonnes)<input required type="number" min="0.001" max="1000000000" step="0.001" value={wagon.capacityTonnes} onChange={event => setWagon({ ...wagon, capacityTonnes: Number(event.target.value) })} /></label>
        <label>Yard / location<input required maxLength={128} list="yard-locations" value={wagon.location} onChange={event => setWagon({ ...wagon, location: event.target.value })} /></label>
        <label className="resource-checkbox"><input type="checkbox" checked={wagon.available} onChange={event => setWagon({ ...wagon, available: event.target.checked })} />Available for allocation</label>
        <label className="resource-checkbox"><input type="checkbox" checked={wagon.active} onChange={event => setWagon({ ...wagon, active: event.target.checked })} />Active wagon</label>
      </> : <>
        <label>Route ID<input required maxLength={128} disabled={editing} value={route.routeId} onChange={event => setRoute({ ...route, routeId: event.target.value.trim() })} /></label>
        <label>Origin yard<input required maxLength={128} list="yard-locations" value={route.origin} onChange={event => setRoute({ ...route, origin: event.target.value })} /></label>
        <label>Destination<input required maxLength={128} value={route.destination} onChange={event => setRoute({ ...route, destination: event.target.value })} /></label>
        <label>Distance (km)<input type="number" required min="0.001" max="1000000000" step="0.001" value={route.distanceKm} onChange={event => setRoute({ ...route, distanceKm: Number(event.target.value) })} /></label>
        <label>Transit time (seconds)<input type="number" required min="1" max="2147483647" step="1" value={route.transitTimeSeconds} onChange={event => setRoute({ ...route, transitTimeSeconds: Number(event.target.value) })} /></label>
        <label className="resource-checkbox"><input type="checkbox" checked={route.active} onChange={event => setRoute({ ...route, active: event.target.checked })} />Active route</label>
      </>}
      <datalist id="yard-locations">{Array.from(new Set(wagons.map(item => item.location))).map(location => <option key={location} value={location} />)}</datalist>
      <div className="resource-actions"><button className="primary-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Save resource"}</button><button type="button" className="secondary-button" onClick={reset} disabled={busy}>Add another</button></div>
    </form></section>
    <label className="resource-search">Find a {kind === "wagons" ? "wagon" : "route"}<input value={filter} onChange={event => setFilter(event.target.value)} placeholder="ID, type, yard or destination" /></label>
    {loading ? <LoadingState label="Loading the yard…" /> : <div className="records-table-wrap" tabIndex={0} role="region" aria-label="Scrollable data table"><table className="records-table"><thead><tr><th>Resource</th><th>{kind === "wagons" ? "Capacity / yard" : "Journey"}</th><th>Status</th><th>Action</th></tr></thead><tbody>{kind === "wagons" ? wagons.filter(item => `${item.wagonId} ${item.wagonType} ${item.location}`.toLowerCase().includes(text)).map(item => <tr key={item.wagonId}><td><strong>{item.wagonId}</strong><small>{item.wagonType}</small></td><td>{item.capacityTonnes} t · {item.location}</td><td>{!item.active ? "Inactive" : item.available ? "Available" : "Unavailable"}</td><td><button type="button" className="text-link" onClick={() => { setWagon(item); setEditing(true); setNotice(""); }}>Edit {item.wagonId}</button></td></tr>) : routes.filter(item => `${item.routeId} ${item.origin} ${item.destination}`.toLowerCase().includes(text)).map(item => <tr key={item.routeId}><td><strong>{item.routeId}</strong><small>{item.origin} → {item.destination}</small></td><td>{item.distanceKm} km · {(item.transitTimeSeconds / 3600).toFixed(2)} hours</td><td>{item.active ? "Active" : "Inactive"}</td><td><button type="button" className="text-link" onClick={() => { setRoute(item); setEditing(true); setNotice(""); }}>Edit {item.routeId}</button></td></tr>)}</tbody></table><p>Showing up to 2,000 resources. Changes affect future allocation runs.</p></div>}
  </section>;
}
