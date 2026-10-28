import { useEffect, useState } from "react";
import { Link } from "react-router";
import { listOrders, type OrderList } from "../api/orders";
import { OrderEntryForm } from "../components/OrderEntryForm";

export function OrdersPage() {
  const [status, setStatus] = useState("");
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<OrderList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setData(null);
    listOrders(status, offset, controller.signal).then(result => {
      if (!controller.signal.aborted) setData(result);
    }).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Orders could not load. Retry below.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [status, offset, revision]);
  function refresh() { setRevision(value => value + 1); }
  return <section className="orders-page">
    <header className="teaching-header"><h1>Freight orders</h1><p>Your freight queue, from first entry to allocation. Pending orders are available for planning; Planned orders have been included in a saved allocation.</p><div className="workflow-links"><Link to="/allocations">Allocate pending orders</Link><Link to="/ai-lab">Explore CP-SAT & ML</Link></div></header>
    <section className="optimization-panel" aria-labelledby="order-list-title">
      <div className="order-toolbar"><h2 id="order-list-title">Order register</h2><label>Status<select value={status} onChange={event => { setStatus(event.target.value); setOffset(0); }}><option value="">All orders</option><option value="Pending">Pending</option><option value="Planned">Planned</option></select></label><button className="secondary-button" onClick={refresh} disabled={loading}>Refresh orders</button></div>
      {loading && <p role="status">Loading freight orders…</p>}
      {error && <div role="alert"><p className="form-error">{error}</p><button className="secondary-button" onClick={refresh}>Retry orders</button></div>}
      {data && <><p role="status">{data.total} {status.toLowerCase()} orders found</p>{data.items.length ? <div className="assignment-table-wrap" tabIndex={0} role="region" aria-label="Scrollable data table"><table className="assignment-table"><caption className="sr-only">Freight order register</caption><thead><tr><th>Order / cargo</th><th>Destination</th><th>Tonnes</th><th>Priority</th><th>Required by</th><th>Status</th></tr></thead><tbody>{data.items.map(order => <tr key={order.orderId}><td><strong>{order.orderId}</strong><small>{order.cargoType}</small></td><td>{order.destination}</td><td>{order.quantityTonnes}</td><td>{({1: "Urgent", 2: "Standard", 3: "Flexible"} as Record<number, string>)[order.priority] ?? order.priority}</td><td>{new Date(order.deadline).toLocaleString()}</td><td><span className="order-state">{order.status}</span></td></tr>)}</tbody></table></div> : <p>No orders match this view. Add freight below or choose another status.</p>}
      <div className="order-toolbar"><button className="secondary-button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>Previous</button><span>Page {Math.floor(offset / 20) + 1}</span><button className="secondary-button" disabled={data.nextOffset === null} onClick={() => setOffset(data.nextOffset ?? offset)}>Next</button></div></>}
    </section>
    <OrderEntryForm onCreated={() => { setStatus(""); setOffset(0); refresh(); }} />
  </section>;
}
