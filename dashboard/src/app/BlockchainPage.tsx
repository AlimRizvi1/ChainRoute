import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { mineBlock, readBlocks, type ChainBlock, type ChainWindow } from "../api/blockchain";
import { LoadingState } from "../components/StatePanel";
import "./blockchain.css";

gsap.registerPlugin(useGSAP);
const shortHash = (hash: string) => `${hash.slice(0, 10)}…${hash.slice(-6)}`;

export function BlockchainPage() {
  const [ledger, setLedger] = useState<ChainWindow | null>(null);
  const [from, setFrom] = useState(0);
  const [liveMode, setLiveMode] = useState(false);
  const [zone, setZone] = useState("UTC");
  const [revision, setRevision] = useState(0);
  const [paused, setPaused] = useState(false);
  const [motion, setMotion] = useState(() => !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  const [replay, setReplay] = useState<ChainBlock[] | null>(null);
  const [step, setStep] = useState(1);
  const [selectedHash, setSelectedHash] = useState<string>();
  const [error, setError] = useState("");
  const [mining, setMining] = useState(false);
  const [visible, setVisible] = useState(true);
  const root = useRef<HTMLElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const timestampFormat = useMemo(() => new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: zone, timeZoneName: "short",
  }), [zone]);
  const formatTime = (timestamp: string) => timestampFormat.format(new Date(timestamp));
  useEffect(() => {
    let inView = true;
    const update = () => setVisible(inView && !document.hidden);
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => { inView = entries[0]?.isIntersecting ?? true; update(); });
    if (root.current) observer?.observe(root.current);
    const preference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const reduce = () => { if (preference?.matches) setMotion(false); };
    document.addEventListener("visibilitychange", update);
    preference?.addEventListener("change", reduce);
    return () => { observer?.disconnect(); document.removeEventListener("visibilitychange", update); preference?.removeEventListener("change", reduce); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function update() {
      try {
        const data = await readBlocks(from, controller.signal, liveMode);
        if (!controller.signal.aborted) { setLedger(data); setError(""); }
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "The ledger could not be loaded."); }
      finally { if (!controller.signal.aborted && !paused && !replay) timer = setTimeout(() => void update(), 5000); }
    }
    void update();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [from, liveMode, paused, Boolean(replay), revision]);

  useEffect(() => {
    if (!replay || paused || step >= replay.length || !visible) return;
    const timer = setTimeout(() => setStep(value => value + 1), 1800);
    return () => clearTimeout(timer);
  }, [replay, step, paused, visible]);

  const blocks = replay ? replay.slice(0, step) : ledger?.blocks ?? [];
  const latest = blocks.at(-1);
  const selected = ledger && ledger.genesis.hash === selectedHash ? ledger.genesis : blocks.find(block => block.hash === selectedHash) ?? (from === 0 && !liveMode && !replay ? blocks[0] : latest);
  useGSAP(() => {
    if (!latest || !viewport.current || !window.matchMedia || !visible) return;
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      if (!motion) return;
      const rail = root.current?.querySelector(".chain-rail");
      const newest = root.current?.querySelector(replay || liveMode ? ".chain-block:last-child" : ".chain-block:first-child");
      if (!rail || !newest) return;
      gsap.timeline().fromTo(rail, { x: 36 }, { x: 0, duration: .7, ease: "power3.out" })
        .fromTo(newest, { y: -28, rotate: 3, scale: .96 }, { y: 0, rotate: 0, scale: 1, duration: .7, ease: "power3.out" }, 0)
        .fromTo(newest.querySelector(".block-seal"), { scaleX: 0 }, { scaleX: 1, duration: .4, transformOrigin: "left" }, .3);
      const links = root.current?.querySelectorAll(".chain-link path");
      if (links?.length) gsap.fromTo(links, { strokeDasharray: 75, strokeDashoffset: 75 }, { strokeDashoffset: 0, duration: .65, stagger: .035, ease: "power3.out" });
      gsap.to(viewport.current, { scrollLeft: replay || liveMode ? viewport.current!.scrollWidth : 0, duration: .7, ease: "power3.out" });
    });
    if (!motion || window.matchMedia("(prefers-reduced-motion: reduce)").matches) viewport.current.scrollLeft = replay || liveMode ? viewport.current.scrollWidth : 0;
    return () => mm.revert();
  }, { scope: root, dependencies: [latest?.hash, motion, liveMode, Boolean(replay), visible], revertOnUpdate: true });

  async function addBlock() {
    if (mining) return;
    setMining(true); setError("");
    try { await mineBlock(); setLiveMode(true); setReplay(null); refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Block creation failed."); }
    finally { setMining(false); }
  }
  function showWindow(start: number, live = false) { setReplay(null); setFrom(start); setLiveMode(live); setSelectedHash(undefined); refresh(); }

  return <section className="blockchain-page" ref={root} aria-labelledby="blockchain-title">
    <header className="blockchain-heading"><div><h1 id="blockchain-title">Every chain has a beginning.</h1><p>Start at Genesis. Follow the blocks, inspect their parent links and watch freight actions become recorded history.</p></div><Link className="secondary-button" to="/contracts">Open freight contracts</Link></header>
    <div className="ledger-status"><span className={`ledger-indicator ${paused || replay || error ? "is-paused" : ""}`} aria-hidden="true" /><strong>{replay ? `Replay · ${step} of ${replay.length} recorded blocks` : paused ? "Refresh paused" : error ? "Connection interrupted" : liveMode ? "Latest blocks · refreshes every 5 seconds" : "History from Genesis · refreshes every 5 seconds"}</strong>{ledger && <span>Chain {ledger.chainId} · head #{ledger.head.toLocaleString()}</span>}</div>
    {error && <p className="form-error" role="alert">{error} {ledger && "Showing the last successful read."} <button type="button" onClick={refresh} className="text-link">Retry</button></p>}
    {!ledger && !error && <LoadingState label="Reading the chain…" />}
    {ledger && <>
      <div className="genesis-origin"><button type="button" onClick={() => { showWindow(0); setSelectedHash(ledger.genesis.hash); }} aria-label="Inspect Genesis block"><span className="genesis-number" aria-hidden="true">0</span><span><strong>Genesis block</strong><span>The first block. Every parent link starts here.</span></span></button><div><span>Recorded chain start</span><time dateTime={ledger.genesis.timestamp}>{formatTime(ledger.genesis.timestamp)}</time></div><code title={ledger.genesis.hash}>{shortHash(ledger.genesis.hash)}</code></div>
      <div className="ledger-controls">
        <button className="secondary-button" type="button" onClick={() => setPaused(value => !value)}>{paused ? "Resume" : "Pause"}</button>
        <button className="secondary-button" type="button" onClick={() => { setReplay(ledger.blocks); setStep(1); setPaused(false); setSelectedHash(undefined); }}>Replay this window</button>
        <button className="secondary-button" type="button" onClick={() => showWindow(0)}>From Genesis</button>
        <button className="secondary-button" type="button" onClick={() => showWindow(0, true)}>Latest blocks</button>
        <button className="secondary-button" type="button" disabled={ledger.nextBefore === null || Boolean(replay)} onClick={() => showWindow(Math.max(0, ledger.blocks[0].number - 12))}>Earlier blocks</button>
        <button className="secondary-button" type="button" disabled={ledger.nextFrom === null || Boolean(replay)} onClick={() => showWindow(ledger.nextFrom!)}>Newer blocks</button>
        <label className="block-time-zone">Block time zone<select value={zone} onChange={event => setZone(event.target.value)}><option value="UTC">UTC</option><option value="Asia/Kolkata">IST · UTC+05:30</option></select></label>
        <label className="motion-toggle"><input type="checkbox" checked={motion} onChange={event => setMotion(event.target.checked)} /> Animate blocks</label>
        {ledger.canMine && <button type="button" className="primary-button" disabled={mining} onClick={() => void addBlock()}>{mining ? "Adding block…" : "Add demonstration block"}</button>}
      </div>
      <p className="chain-clock-note">Dates come directly from the node’s block headers, including synthetic shipment time advances. Replay keeps the original timestamps; the last-read time is shown separately.</p>
      <div className="chain-stage"><div className="chain-caption"><span>{replay ? "Recorded history, replayed" : "On-chain block headers"}</span><span>#{blocks[0]?.number ?? 0} → #{latest?.number ?? 0} · earlier → newer</span></div>
        <div className="chain-viewport" ref={viewport} tabIndex={0} role="region" aria-label="Blockchain strip. Scroll horizontally to inspect blocks.">
          <ol className="chain-rail">{blocks.map((block, i) => <li className={`chain-block ${block.number === 0 ? "is-genesis" : ""}`} key={block.hash}>
            {i > 0 && <span className="chain-link" title={block.parentHash === blocks[i - 1].hash ? "Parent hash matches the preceding block" : "Parent hash differs"} aria-hidden="true"><svg viewBox="0 0 52 24"><path d="M0 12h52m-8-6 8 6-8 6" /></svg></span>}
            <button type="button" className={`block-face ${selected?.hash === block.hash ? "is-selected" : ""}`} aria-pressed={selected?.hash === block.hash} onClick={() => setSelectedHash(block.hash)}>
              <span className="block-number">{block.number === 0 ? "GENESIS BLOCK" : "BLOCK"} <strong>#{block.number.toLocaleString()}</strong></span>
              <time dateTime={block.timestamp} title={block.timestamp}>{formatTime(block.timestamp)}</time>
              <span className="block-hash"><small>HASH</small><code>{shortHash(block.hash)}</code></span>
              <span className="block-hash"><small>PARENT</small><code>{shortHash(block.parentHash)}</code></span>
              <span className="block-seal">{block.transactions.length} transaction{block.transactions.length === 1 ? "" : "s"} · {Number(block.gasUsed).toLocaleString()} gas</span>
            </button></li>)}</ol>
        </div><p className="chain-hint">Select a block to unfold its structure. Arrows follow each block’s parent hash.</p>
      </div>
      <div className="ledger-detail-grid">
        {selected && <section className="block-inspector" aria-labelledby="inspector-title"><header><h2 id="inspector-title">Inside block #{selected.number}</h2><span>{selected.transactions.length ? "Transactions recorded" : "Empty block"}</span></header>
          {selected.number === 0 && <p>This is Genesis, block #0. Its zero parent hash marks the origin of this local chain.</p>}
          <dl className="block-fields"><Field label="Block hash" value={selected.hash} /><Field label="Parent hash" value={selected.parentHash} /><Field label="Added to chain" value={formatTime(selected.timestamp)} /><Field label="Timestamp (UTC)" value={selected.timestamp} /><Field label="State root" value={selected.stateRoot} /><Field label="Transactions root" value={selected.transactionsRoot} /><Field label="Receipts root" value={selected.receiptsRoot} /><Field label="Gas used / limit" value={`${selected.gasUsed} / ${selected.gasLimit}`} /><Field label="Base fee (wei)" value={selected.baseFeePerGas ?? "Not provided by node"} /><Field label="Size / nonce" value={`${selected.size} bytes / ${selected.nonce}`} /><Field label="Block beneficiary" value={selected.miner} /></dl>
          <h3>Transaction hashes</h3>{selected.transactions.length ? <ol className="transaction-hashes">{selected.transactions.map(hash => <li key={hash}><code>{hash}</code></li>)}</ol> : <p>No transactions are stored in this block. Demonstration blocks show chain growth without changing freight agreements.</p>}
        </section>}
        <aside className="ledger-explanation"><h2>What you’re seeing</h2><ol><li><strong>A freight action is submitted.</strong><p>Accepting a plan, booking freight, recording delivery or resolving a dispute sends a transaction to the settlement contract.</p></li><li><strong>The node adds a block.</strong><p>The transaction changes contract state. Its receipt records events that the backend synchronizes into the contract timeline.</p></li><li><strong>The next block references it.</strong><p>The parent hash links the new block to the previous one. State and receipt roots commit to the resulting data.</p></li></ol>
          <div className="ledger-network"><h3>{ledger.localDevelopment ? "Local development chain" : "Connected EVM network"}</h3><p>{ledger.localDevelopment ? "This node mines on demand. It demonstrates EVM execution and hash-linked history; it is not a decentralized production network or a proof-of-work simulation." : "Blocks and timestamps come directly from the configured network."}</p><p>Freight amounts are INR accounting values; this project does not transfer real money.</p><dl><dt>Node</dt><dd>{ledger.clientVersion}</dd><dt>Settlement contract</dt><dd><code>{ledger.contractAddress ?? "Not deployed"}</code></dd><dt>Last successful read</dt><dd>{new Date(ledger.observedAt).toLocaleString()}</dd></dl></div>
          <Link className="text-link" to="/ai-lab">Explore the allocation and ML lab</Link>
        </aside>
      </div>
    </>}
  </section>;
}
function Field({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd><code>{value}</code></dd></div>; }
