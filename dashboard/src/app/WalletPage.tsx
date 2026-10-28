import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { formatEther } from "ethers";
import { apiRequest } from "../api/client";
import { getDappConfig, listWalletFreights, refreshWalletFreight, submitWalletFreight, type DappConfig, type WalletFreight, type WalletTransaction } from "../api/dapp";
import { connectWallet, metamask, sendWalletTransaction, walletError } from "../dapp/wallet";
import { useAuth } from "../auth/context";
import "./wallet.css";

type Recovery = { kind: "deployment" | "freight" | "action"; hash: string; freightId?: string; action?: string };
const short = (value: string) => `${value.slice(0, 8)}…${value.slice(-6)}`;

export function WalletPage() {
  const { session } = useAuth(); const [params] = useSearchParams();
  const [config, setConfig] = useState<DappConfig | null>(null);
  const [items, setItems] = useState<WalletFreight[]>([]);
  const [connected, setConnected] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState(""); const [error, setError] = useState("");
  const recoveryKey = `chainroute.wallet.pending.v1.${session!.user.id}`;
  const [recovery, setRecovery] = useState<Recovery | null>(() => { try { return JSON.parse(localStorage.getItem(recoveryKey) || "null"); } catch { return null; } });
  const [planId, setPlanId] = useState(params.get("plan") || "");
  const [carrier, setCarrier] = useState(""); const [freightValue, setFreightValue] = useState("25000");
  const [penalty, setPenalty] = useState("100"); const [period, setPeriod] = useState("3600");
  const [holding, setHolding] = useState("4"); const [demurrage, setDemurrage] = useState("5000");
  const admin = session?.user.role === "Administrator";
  const initiator = admin || session?.user.role === "Shipper";
  const load = useCallback(async () => {
    const [next, records] = await Promise.all([getDappConfig(), listWalletFreights()]); setConfig(next); setItems(records.items);
  }, []);
  useEffect(() => { let active = true; void load().catch(cause => { if (active) setError(walletError(cause)); }); return () => { active = false; }; }, [load]);
  useEffect(() => {
    let wallet; try { wallet = metamask(); } catch { return; }
    const changed = () => { setConnected(null); setBalance(null); setNotice("Your wallet account or network changed. Connect again to check it before signing."); };
    wallet.on?.("accountsChanged", changed); wallet.on?.("chainChanged", changed);
    return () => { wallet.removeListener?.("accountsChanged", changed); wallet.removeListener?.("chainChanged", changed); };
  }, []);
  function saveRecovery(value: Recovery | null) { setRecovery(value); if (value) localStorage.setItem(recoveryKey, JSON.stringify(value)); else localStorage.removeItem(recoveryKey); }
  async function operation(fn: () => Promise<void>) {
    if (busy) return; setBusy(true); setError("");
    try { await fn(); } catch (cause) { setError(walletError(cause)); } finally { setBusy(false); }
  }
  async function connect() {
    if (!config) return;
    const result = await connectWallet(config); setConnected(result.address); setBalance(result.balance);
    await load(); setNotice("Wallet ownership verified. Transaction approvals will open in MetaMask.");
  }
  async function reconcile(value: Recovery) {
    if (value.kind === "deployment") {
      const result = await apiRequest<{ status: string }>("/dapp/deployments", { method: "POST", body: { transactionHash: value.hash }, signal: AbortSignal.timeout(30_000) });
      if (result.status === "pending") { setNotice("Deployment is waiting for network confirmations. Check again shortly."); return; }
      saveRecovery(null); await load(); setNotice("Freight contract confirmed. Its deployment and all future freight transactions can be inspected on the explorer.");
    } else if (value.kind === "freight") {
      await submitWalletFreight(value.freightId!, value.hash);
      const row = await refreshWalletFreight(value.freightId!);
      await load();
      if (row.pending || row.state === "Submitted") { setNotice("Freight transaction submitted. Waiting for confirmation and token mint verification."); return; }
      saveRecovery(null); setNotice(row.state === "Failed" ? "The transaction failed on-chain. Gas may have been charged; inspect the receipt on the explorer." : `Freight confirmed. Receipt token #${row.token_id} was minted to your wallet.`);
    } else {
      const result = await apiRequest<{ status: string }>(`/dapp/freights/${value.freightId}/action-receipt`, { method: "POST", body: { transactionHash: value.hash } , signal: AbortSignal.timeout(30_000) });
      if (result.status === "pending") { setNotice("Contract action is waiting for confirmation."); return; }
      await refreshWalletFreight(value.freightId!); await load(); saveRecovery(null); setNotice(`Contract action ${result.status}. Inspect its transaction on the explorer.`);
    }
  }
  async function deploy() {
    if (!config?.linkedAddress) return;
    const build = await apiRequest<{ bytecode: string }>("/dapp/build");
    setNotice("Review contract deployment and gas in MetaMask. No freight payment is included.");
    const hash = await sendWalletTransaction(config, { from: config.linkedAddress, data: build.bytecode, value: "0x0", chainId: config.chainId });
    const pending: Recovery = { kind: "deployment", hash }; saveRecovery(pending); setNotice("Deployment submitted. Check its receipt after the next blocks.");
    await reconcile(pending);
  }
  async function initiate() {
    if (!config?.linkedAddress) return;
    const parts = /^(\d+)(?:\.(\d{1,2}))?$/.exec(freightValue);
    if (!parts) throw new Error("Enter a freight value with at most two decimal places.");
    const paise = (BigInt(parts[1]) * 100n + BigInt((parts[2] || "").padEnd(2, "0"))).toString();
    const prepared = await apiRequest<{ freight: WalletFreight; transaction: WalletTransaction }>("/dapp/freights/prepare", { method: "POST", body: { planId: planId.trim(), carrierAddress: carrier.trim(), terms: { freightValuePaise: paise, penaltyBpsPerBlock: Number(penalty), penaltyBlockSeconds: Number(period), freeHoldingHours: Number(holding), demurrageRatePaisePerWagonHour: demurrage } } });
    if (prepared.freight.transaction_hash) { await reconcile({ kind: "freight", hash: prepared.freight.transaction_hash, freightId: prepared.freight.freight_id }); return; }
    setNotice("Review freight initiation in MetaMask. You pay network gas; the same transaction mints your freight receipt.");
    const hash = await sendWalletTransaction(config, prepared.transaction);
    const pending: Recovery = { kind: "freight", hash, freightId: prepared.freight.freight_id }; saveRecovery(pending);
    await reconcile(pending);
  }
  async function action(row: WalletFreight, body: Record<string, unknown>) {
    if (!config) return;
    const prepared = await apiRequest<WalletTransaction>(`/dapp/freights/${row.freight_id}/action`, { method: "POST", body, signal: AbortSignal.timeout(30_000) });
    setNotice("Review this contract action and its network gas fee in MetaMask.");
    const hash = await sendWalletTransaction(config, prepared);
    const pending: Recovery = { kind: "action", hash, freightId: row.freight_id, action: String(body.action) }; saveRecovery(pending);
    await reconcile(pending);
  }
  useEffect(() => {
    if (!recovery || !config || busy) return;
    const timer = window.setInterval(() => { if (!document.hidden) void operation(() => reconcile(recovery)); }, 8000);
    return () => window.clearInterval(timer);
  }, [recovery, config, busy]);
  return <section className="wallet-page">
    <header className="wallet-heading"><div><h1>Wallet & freight</h1><p>Sign freight agreements. Hold their receipts. Follow each transaction on {config?.chainName || "Sepolia"}.</p></div><Link to="/blockchain">Explore the local demo chain</Link></header>
    {error && <p className="wallet-message is-error" role="alert">{error}</p>}
    {notice && <p className="wallet-message" role="status">{notice}</p>}
    {!config ? <p role="status">Loading wallet configuration…</p> : <>
      <section className="wallet-connection" aria-labelledby="wallet-title">
        <div><h2 id="wallet-title">{config.chainName} wallet</h2><p className="wallet-network">{config.chainId === 11155111 ? "Public testnet" : "Local development"} · Chain {config.chainId} · Gas paid in test ETH</p><p>{config.linkedAddress ? <>Linked account <code>{config.linkedAddress}</code></> : "Connect MetaMask and sign a free ownership message to link your account."}</p>{connected && <p>Connected <strong>{short(connected)}</strong>{balance && <> · {Number(balance).toFixed(6)} test ETH at connection</>}</p>}</div>
        <button className="primary-button" type="button" disabled={busy} onClick={() => void operation(connect)}>{busy ? "Complete wallet request…" : connected ? "Check wallet" : "Connect MetaMask"}</button>
      </section>
      <ol className="wallet-flow" aria-label="Freight transaction sequence"><li>Review saved allocation</li><li>Approve in MetaMask</li><li>Confirm on-chain</li><li>Receive CRFR token</li></ol>
      <p className="wallet-cost-note">Only network gas is deducted from the signing wallet. Freight values remain INR accounting terms; no ETH freight charge or escrow is collected. CRFR is an ERC-721 receipt, not a currency or legal cargo title.</p>
      {recovery && <section className="wallet-pending"><h2>Transaction awaiting confirmation</h2><p>Your transaction hash is saved in this browser. Check its receipt before sending another transaction.</p><Explorer config={config} hash={recovery.hash} /><button className="primary-button" type="button" disabled={busy} onClick={() => void operation(() => reconcile(recovery))}>Check transaction receipt</button></section>}
      {!config.deployment ? <section className="wallet-deployment"><h2>Deploy the freight contract</h2><p>No {config.chainName} freight contract is registered yet. Deployment is a one-time administrator transaction and mints no freight token by itself.</p>{admin ? <button type="button" className="primary-button" disabled={busy || !connected || !!recovery} onClick={() => void operation(deploy)}>Deploy with MetaMask</button> : <p>An administrator must connect their wallet and deploy the contract first.</p>}</section> : <section className="wallet-deployment"><h2>Freight contract</h2><p><code>{config.deployment.address}</code></p><p>Operator wallet <code>{config.deployment.operator_address}</code></p><Explorer config={config} hash={config.deployment.transaction_hash} />{config.explorer && <a href={`${config.explorer}/address/${config.deployment.address}#code`} target="_blank" rel="noreferrer">View contract on explorer</a>}{admin && <button className="wallet-text-button" type="button" onClick={() => void operation(async () => { const build = await apiRequest<{ standardInput: unknown }>("/dapp/build"); const url = URL.createObjectURL(new Blob([JSON.stringify(build.standardInput, null, 2)], { type: "application/json" })); const a = document.createElement("a"); a.href = url; a.download = "chainroute-solidity-standard-input.json"; a.click(); URL.revokeObjectURL(url); })}>Download source verification input</button>}</section>}
      {initiator && <form className="wallet-initiation" onSubmit={event => { event.preventDefault(); void operation(initiate); }}><h2>Initiate a freight</h2><p>Use a new <Link to="/allocations">saved allocation</Link> owned by this account. Its wagon count and deadline come from the saved plan.</p><div className="wallet-fields">
        <label className="wallet-wide">Saved plan ID<input required value={planId} onChange={e => setPlanId(e.target.value)} placeholder="Choose a saved allocation first" /></label>
        {config.carriers.length > 0 && <label className="wallet-wide">Registered carrier<select value={carrier} onChange={e => setCarrier(e.target.value)}><option value="">Choose or enter a carrier wallet below</option>{config.carriers.map(c => <option key={c.address} value={c.address}>{c.username} · {short(c.address)}</option>)}</select></label>}
        <label className="wallet-wide">Carrier wallet<input required pattern="0x[0-9a-fA-F]{40}" value={carrier} onChange={e => setCarrier(e.target.value)} placeholder="0x…" /><small>This wallet signs booking and delivery. It must differ from the shipper.</small></label>
        <label>Freight value (INR)<input required type="number" min="0.01" step="0.01" value={freightValue} onChange={e => setFreightValue(e.target.value)} /></label>
        <label>Penalty rate (basis points)<input required type="number" min="0" max="10000" step="1" value={penalty} onChange={e => setPenalty(e.target.value)} /></label>
        <label>Penalty period (seconds)<input required type="number" min="1" step="1" value={period} onChange={e => setPeriod(e.target.value)} /></label>
        <label>Free holding (hours)<input required type="number" min="0" max="65535" step="1" value={holding} onChange={e => setHolding(e.target.value)} /></label>
        <label>Demurrage (paise / wagon / hour)<input required type="number" min="0" step="1" value={demurrage} onChange={e => setDemurrage(e.target.value)} /></label>
      </div><button className="primary-button" type="submit" disabled={busy || !connected || !config.deployment || !!recovery}>Initiate freight & mint receipt</button><p className="wallet-fine-print">MetaMask displays the gas estimate before you approve. Public chain timestamps come from the network. Never enter a seed phrase or private key in ChainRoute.</p></form>}
      <section className="wallet-ledger"><div className="wallet-ledger-heading"><h2>Wallet freight receipts</h2><button type="button" disabled={busy} onClick={() => void operation(load)}>Refresh list</button></div>{items.length === 0 ? <p>No wallet freight has been initiated on this network. Existing local demo agreements remain under <Link to="/contracts">Contracts</Link>.</p> : items.map(row => <FreightReceipt key={row.freight_id} row={row} config={config} busy={busy || !!recovery} role={session!.user.role} onRefresh={() => void operation(async () => { const refreshed = await refreshWalletFreight(row.freight_id); await load(); setNotice(refreshed.pending ? "Waiting for network confirmations." : `Receipt checked: ${refreshed.state}.`); })} onResume={() => void operation(async () => { const hash = await sendWalletTransaction(config, { from: row.shipper_address, to: row.settlement_address, data: row.transaction_data, value: "0x0", chainId: config.chainId }); const pending: Recovery = { kind: "freight", hash, freightId: row.freight_id }; saveRecovery(pending); await reconcile(pending); })} onAction={body => void operation(() => action(row, body))} />)}</section>
    </>}
  </section>;
}

function Explorer({ config, hash }: { config: DappConfig; hash: string }) { return config.explorer ? <a className="wallet-explorer" href={`${config.explorer}/tx/${hash}`} target="_blank" rel="noreferrer">View transaction <code>{short(hash)}</code></a> : <code>{hash}</code>; }
function FreightReceipt({ row, config, busy, role, onRefresh, onResume, onAction }: { row: WalletFreight; config: DappConfig; busy: boolean; role: string; onRefresh: () => void; onResume: () => void; onAction: (body: Record<string, unknown>) => void }) {
  const [pod, setPod] = useState(""); const [reason, setReason] = useState(""); const [outcome, setOutcome] = useState("0");
  const isCarrier = role === "Carrier" && config.linkedAddress?.toLowerCase() === row.carrier_address.toLowerCase();
  const isParty = ["Shipper", "Carrier"].includes(role) && [row.shipper_address, row.carrier_address].some(a => a.toLowerCase() === config.linkedAddress?.toLowerCase());
  const operator = role === "Administrator" && config.linkedAddress?.toLowerCase() === config.deployment?.operator_address.toLowerCase();
  return <article className="wallet-receipt"><header><h3>{row.token_id ? `Freight receipt #${row.token_id}` : "Prepared freight"}</h3><span className={`wallet-state ${row.state === "Failed" ? "is-failed" : ""}`}>{row.state}</span></header><dl><div><dt>Saved plan</dt><dd><Link to={`/allocations?plan=${encodeURIComponent(row.plan_id)}`}>{row.plan_id}</Link></dd></div><div><dt>Shipper</dt><dd><code>{row.shipper_address}</code></dd></div><div><dt>Carrier</dt><dd><code>{row.carrier_address}</code></dd></div>{row.terms && <><div><dt>Agreed freight (INR)</dt><dd>{(BigInt(row.terms.freightValuePaise) / 100n).toLocaleString("en-IN")}.{(BigInt(row.terms.freightValuePaise) % 100n).toString().padStart(2, "0")} · accounting only</dd></div><div><dt>Wagons / SLA (UTC)</dt><dd>{row.terms.wagonCount} wagons · {new Date(row.terms.slaDeadline * 1000).toISOString()}</dd></div><div><dt>Deductions</dt><dd>{row.terms.penaltyBpsPerBlock} basis points per {row.terms.penaltyBlockSeconds} seconds late · {row.terms.freeHoldingHours} free holding hours · {row.terms.demurrageRatePaisePerWagonHour} paise / wagon / hour</dd></div></>}<div><dt>Terms & allocation hash</dt><dd><code>{row.terms_hash}</code></dd></div>{row.block_number && <><div><dt>Initiation block</dt><dd>{row.block_number}</dd></div><div><dt>Added to chain (UTC)</dt><dd><time>{row.block_timestamp ? new Date(row.block_timestamp).toISOString() : "Awaiting timestamp"}</time></dd></div><div><dt>Initiation gas paid</dt><dd>{row.fee_wei ? formatEther(row.fee_wei) : "0"} test ETH</dd></div><div><dt>Receipt token</dt><dd>ERC-721 · CRFR · Token ID {row.token_id}<small>Import using contract {row.settlement_address} and this token ID.</small></dd></div></>}</dl>
    <div className="wallet-receipt-actions">{row.transaction_hash && <Explorer config={config} hash={row.transaction_hash} />}<button type="button" disabled={busy} onClick={onRefresh}>Check on-chain status</button>{row.state === "Prepared" && row.shipper_address.toLowerCase() === config.linkedAddress?.toLowerCase() && <button type="button" disabled={busy} onClick={onResume}>Sign prepared freight</button>}</div>
    {!!row.actions?.length && <details><summary>Contract transaction history ({row.actions.length})</summary><ul>{row.actions.map(entry => <li key={entry.transactionHash}><strong>{entry.action}</strong> · {entry.status} · {entry.timestamp ? new Date(entry.timestamp).toISOString() : "Waiting for confirmation"} · <Explorer config={config} hash={entry.transactionHash} /></li>)}</ul></details>}
    <div className="wallet-contract-actions">{isCarrier && row.state === "Created" && <button disabled={busy} onClick={() => onAction({ action: "confirmBooking" })}>Confirm booking in MetaMask</button>}{isCarrier && ["Booked", "InTransit"].includes(row.state) && <><button disabled={busy} onClick={() => onAction({ action: "updateShipmentStatus", status: 0, timestamp: Math.floor(Date.now() / 1000) })}>Record dispatch</button><button disabled={busy} onClick={() => onAction({ action: "updateShipmentStatus", status: 1, timestamp: Math.floor(Date.now() / 1000) })}>Record checkpoint</button><button disabled={busy} onClick={() => onAction({ action: "updateShipmentStatus", status: 2, timestamp: Math.floor(Date.now() / 1000) })}>Record arrival</button></>}
      {isCarrier && row.state === "InTransit" && <form onSubmit={e => { e.preventDefault(); onAction({ action: "confirmDelivery", timestamp: Math.floor(Date.now() / 1000), podReference: pod }); }}><label>Proof-of-delivery reference<input required value={pod} maxLength={256} onChange={e => setPod(e.target.value)} /></label><button disabled={busy}>Confirm delivery in MetaMask</button></form>}
      {isParty && row.state === "PenaltyCalculated" && <form onSubmit={e => { e.preventDefault(); onAction({ action: "raiseDispute", reasonCode: reason }); }}><label>Dispute reason<input required value={reason} maxLength={128} onChange={e => setReason(e.target.value)} /></label><button disabled={busy}>Raise dispute in MetaMask</button></form>}
      {operator && row.state === "Disputed" && <form onSubmit={e => { e.preventDefault(); onAction({ action: "resolveDispute", outcome: Number(outcome) }); }}><label>Dispute decision<select value={outcome} onChange={e => setOutcome(e.target.value)}><option value="0">Uphold deductions</option><option value="1">Waive penalty</option><option value="2">Waive all deductions</option></select></label><button disabled={busy}>Resolve in MetaMask</button></form>}
      {operator && row.state === "PenaltyCalculated" && <button disabled={busy} onClick={() => onAction({ action: "releasePayment" })}>Record settlement in MetaMask</button>}{operator && row.state === "PaymentReleased" && <button disabled={busy} onClick={() => onAction({ action: "closeContract" })}>Close contract in MetaMask</button>}
    </div>
  </article>;
}
