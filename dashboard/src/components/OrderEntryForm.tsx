import { useState, type FormEvent } from "react";
import { createOrder, type OrderInput } from "../api/optimization";
import { ApiError } from "../api/errors";

function localDeadline(days: number) {
  const date = new Date(Date.now() + days * 86400000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function defaultDeadline() { return localDeadline(7); }

export function OrderEntryForm({ onCreated }: { onCreated?: () => void }) {
  const [pendingOrder, setPendingOrder] = useState(false);
  const [orderNotice, setOrderNotice] = useState<string | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);
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
      onCreated?.();
    } catch (cause) {
      setOrderError(cause instanceof ApiError ? cause.message : "Order could not be submitted. Try again.");
    } finally { setPendingOrder(false); }
  }

  return (<section className="optimization-panel order-panel" aria-labelledby="new-order-title">
      <div className="panel-heading"><div><p className="eyebrow">FIRST, THE LOAD</p><h2 id="new-order-title">Add a freight order</h2></div><span className="optimization-step">01</span></div>
      <form className="freight-order-form" onSubmit={submitOrder}>
        <label>Cargo type<input name="cargoType" placeholder="e.g. grain" required maxLength={128} /></label>
        <label>Quantity <span className="unit">tonnes</span><input name="quantityTonnes" type="number" min="0.001" step="0.001" placeholder="40" required /></label>
        <label>Destination<input name="destination" placeholder="e.g. Port-A" required maxLength={256} /></label>
        <label>Priority<select name="priority" defaultValue="2"><option value="1">Urgent</option><option value="2">Standard</option><option value="3">Flexible</option></select></label>
        <label>Required by<input name="deadline" type="datetime-local" min={localDeadline(1 / 1440)} defaultValue={defaultDeadline()} required /></label>
        <button className="primary-button" disabled={pendingOrder} type="submit">{pendingOrder ? "Submitting…" : "Queue order"}<span aria-hidden="true"> ↗</span></button>
      </form>
      {orderNotice && <p className="optimization-notice" role="status">{orderNotice}</p>}
      {orderError && <p className="form-error" role="alert">{orderError}</p>}
    </section>);
}
