import { useEffect, useState } from "react";
import { Link } from "react-router";
import { API_MODE } from "../api/client";
import { getEvaluation, runDemonstration, type DemoOptions, type Demonstration, type Evaluation } from "../api/demonstrations";

const percent = (value: number) => `${(value * 100).toFixed(2)}%`;

export function AiLabPage() {
  const [evidence, setEvidence] = useState<Evaluation | null>(null);
  const [evaluationError, setEvaluationError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (API_MODE === "mock") return;
    const controller = new AbortController();
    setEvaluationError("");
    getEvaluation(controller.signal).then(value => { if (!controller.signal.aborted) setEvidence(value); })
      .catch(cause => { if (!controller.signal.aborted) setEvaluationError(cause instanceof Error ? cause.message : "Evaluation could not load."); });
    return () => controller.abort();
  }, [revision]);
  return <section className="ai-lab">
    <header className="teaching-header"><h1>Inside the allocation</h1><p>CP-SAT decides which wagons can serve which loads. Machine learning estimates the chance of arriving on time. Run both here and see how their outputs become a freight plan.</p><div className="workflow-links"><a href="#cp-sat-demo">CP-SAT demonstration</a><a href="#ml-demo">ML demonstration</a><a href="#model-evaluation">Model accuracy</a><Link to="/overview">Back to overview</Link></div></header>
    <ol className="decision-flow" aria-label="How AI is applied in ChainRoute"><li><strong>Orders & yard</strong><span>Cargo, capacity, location, routes and deadlines enter the allocator.</span></li><li><strong>Feasible allocations</strong><span>CP-SAT searches constraint-safe combinations alongside greedy candidates.</span></li><li><strong>On-time predictions</strong><span>Logistic regression scores each assigned load using slack and cargo variability.</span></li><li><strong>Rank & accept</strong><span>Priority is preserved; your weights rank plans. An accepted plan becomes a contract.</span></li></ol>
    <p className="lab-disclosure">These are synthetic teaching cases sent to the running AI engine. They use the same allocator and predictor as Allocations, with a fixed simulation departure of 7 January 2026, 20:00 UTC. They do not create freight orders or contracts.</p>
    {API_MODE === "mock" && <p className="form-notice">Live demonstrations require the real backend. This dashboard is currently in mock mode.</p>}
    <DemoPanel kind="cp-sat" evidence={evidence} />
    <DemoPanel kind="ml" evidence={evidence} />
    <section className="lab-section" id="model-evaluation" aria-labelledby="evaluation-title"><h2 id="evaluation-title">How accurate is the model?</h2><p>Saved validation evidence from a held-out synthetic dataset. This report measures the trained model; running a demonstration above performs inference and does not retrain or re-evaluate it.</p>
      {evaluationError && <div role="alert"><p className="form-error">{evaluationError}</p><button className="secondary-button" onClick={() => setRevision(value => value + 1)}>Retry evaluation</button></div>}
      {!evidence && !evaluationError && API_MODE !== "mock" && <p role="status">Loading validation evidence…</p>}
      {evidence && <EvaluationReport evidence={evidence} />}
    </section>
  </section>;
}

function DemoPanel({ kind, evidence }: { kind: DemoOptions["kind"]; evidence: Evaluation | null }) {
  const isCp = kind === "cp-sat";
  const [cargo, setCargo] = useState<NonNullable<DemoOptions["cargo"]>>("grain");
  const [slack, setSlack] = useState<NonNullable<DemoOptions["slackRatio"]>>(0);
  const [result, setResult] = useState<Demonstration | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run() {
    setBusy(true); setError(""); setResult(null);
    try { setResult(await runDemonstration({ kind, ...(isCp ? {} : { cargo, slackRatio: slack }) })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Demonstration failed. Try again."); }
    finally { setBusy(false); }
  }
  const prediction = result?.plan.runMetadata.prediction;
  const matchingModel = Boolean(evidence && prediction?.modelVersion === evidence.evaluation.modelVersion && prediction?.method === "logistic_regression");
  return <section className="lab-section" id={isCp ? "cp-sat-demo" : "ml-demo"} aria-labelledby={`${kind}-title`}>
    <h2 id={`${kind}-title`}>{isCp ? "CP-SAT: two loads, two wagons" : "ML: how much time is enough?"}</h2>
    {isCp ? <><p>CP-SAT is Google OR-Tools’ constraint programming solver using Boolean satisfiability techniques. It chooses assignments under capacity, cargo compatibility, wagon location, route, deadline and wagon-reuse constraints. It searches within a time limit; the app also keeps greedy candidates as fallbacks.</p><div className="assignment-table-wrap"><table className="assignment-table"><caption>The deliberate bottleneck in this case</caption><thead><tr><th>Load</th><th>Option A</th><th>Option B</th></tr></thead><tbody><tr><td>ORD-FLEX → Port-A</td><td>WAG-A · 3 hours</td><td>WAG-B · 1 hour</td></tr><tr><td>ORD-ONLY → Port-B</td><td>No route from WAG-A’s yard</td><td>WAG-B · 1 hour</td></tr></tbody></table></div><p>A shortest-route greedy choice gives WAG-B to the flexible load and strands the other. Search can reserve WAG-B for the only load that needs it, and send the flexible load with WAG-A. Both loads have the same priority and enough deadline slack.</p></> : <><p>The model predicts an on-time probability for a 10-tonne load on a four-hour route. Deadline slack is extra time divided by route time: zero, one extra hour (0.25), or two extra hours (0.50). Cargo variability is the second feature.</p><div className="lab-controls"><label>Cargo<select disabled={busy} value={cargo} onChange={event => { setCargo(event.target.value as typeof cargo); setResult(null); }}><option value="grain">Grain</option><option value="coal">Coal</option><option value="steel">Steel</option></select></label><label>Deadline slack<select disabled={busy} value={slack} onChange={event => { setSlack(Number(event.target.value) as typeof slack); setResult(null); }}><option value={0}>0.00 · no extra time</option><option value={0.25}>0.25 · 1 extra hour</option><option value={0.5}>0.50 · 2 extra hours</option></select></label></div></>}
    <button className="primary-button" disabled={busy || API_MODE === "mock"} onClick={() => void run()}>{busy ? "Running live engine…" : isCp ? "Run CP-SAT comparison" : "Predict on-time probability"}</button>
    {busy && <p role="status">Waiting for the AI engine…</p>}{error && <p className="form-error" role="alert">{error}</p>}
    {result && <div className="lab-result" key={result.plan.runId}>
      <h3>Live engine result</h3>
      {isCp ? <><p role="status">Greedy baseline: <strong>{result.baseline?.assignments.length ?? "Unavailable"} / 2 loads</strong>. Optimized plan: <strong>{result.plan.assignments.length} / 2 loads</strong>.</p><div className="assignment-table-wrap"><table className="assignment-table"><caption>Computed wagon assignments</caption><thead><tr><th>Load</th><th>Greedy baseline</th><th>Optimized plan</th><th>Route</th></tr></thead><tbody>{["ORD-FLEX", "ORD-ONLY"].map(orderId => { const assignment = result.plan.assignments.find(item => item.orderId === orderId); return <tr key={orderId}><td>{orderId}</td><td>{result.baseline?.assignments.find(item => item.orderId === orderId)?.wagonIds.join(", ") ?? "Unassigned"}</td><td>{assignment?.wagonIds.join(", ") ?? "Unassigned"}</td><td>{assignment?.route.routeId ?? "—"}</td></tr>; })}</tbody></table></div></> : <><p className="prediction-reading" role="status">{percent(result.plan.metrics.onTimeProbability)} <span>predicted on time</span></p><p>Input: slack ratio <strong>{slack.toFixed(2)}</strong>; cargo <strong>{cargo}</strong>{evidence && <>; variability <strong>{evidence.evaluation.cargoVariability[cargo]}</strong></>}. This probability is used in plan ranking, alongside freight cost and wagon utilization.</p>{matchingModel && evidence && <p className="model-formula">p = 1 / (1 + exp(−z)), where z = {evidence.evaluation.coefficients.intercept.toFixed(4)} + {evidence.evaluation.coefficients.slackRatio.toFixed(4)} × slack + ({evidence.evaluation.coefficients.cargoVariability.toFixed(4)}) × cargo variability.</p>}</>}
      <p>Algorithm: <strong>{result.plan.runMetadata.algorithm}</strong> · Duration: {result.plan.runMetadata.durationMs} ms<br />Prediction: <strong>{prediction?.method ?? "Not reported"}</strong> · Model: <strong>{prediction?.modelVersion ?? "Not reported"}</strong></p>
      {!matchingModel && <p className="form-notice">The live prediction is not yet matched to the saved evaluation model. Do not attribute the accuracy report below to this result; it may be using a fallback or a different model.</p>}
      <details><summary>Inspect this run’s request and response</summary><pre>{JSON.stringify(result, null, 2)}</pre></details>
    </div>}
  </section>;
}

function EvaluationReport({ evidence }: { evidence: Evaluation }) {
  const report = evidence.evaluation;
  const matrix = report.confusionMatrix;
  return <><p><strong>{report.trainingSamples.toLocaleString()} training examples</strong> and <strong>{report.testSamples.toLocaleString()} held-out examples</strong> · seed {report.seed} · classification threshold {report.threshold}.</p>
    <div className="assignment-table-wrap"><table className="assignment-table"><caption>Synthetic holdout results</caption><thead><tr><th>Measure</th><th>Result</th><th>What it means</th></tr></thead><tbody>
      <tr><td>Classification accuracy</td><td>{percent(report.accuracy)}</td><td>Correct on-time / late labels across the holdout.</td></tr>
      <tr><td>Always-on-time baseline</td><td>{percent(report.alwaysOnTimeAccuracy)}</td><td>Accuracy if every shipment is predicted on time.</td></tr>
      <tr><td>Late recall</td><td>{percent(report.lateRecall)}</td><td>Actual late shipments correctly flagged late.</td></tr>
      <tr><td>On-time precision / recall</td><td>{percent(report.onTimePrecision)} / {percent(report.onTimeRecall)}</td><td>Reliability of on-time labels / coverage of actual on-time shipments.</td></tr>
      <tr><td>Probability MAE</td><td>{report.probabilityMae.toFixed(5)}</td><td>Average absolute error against simulator probabilities; this is not accuracy.</td></tr>
      <tr><td>Brier score</td><td>{report.brierScore.toFixed(5)}</td><td>Mean squared error of probabilities against observed labels; lower is better.</td></tr>
    </tbody></table></div>
    <div className="assignment-table-wrap"><table className="assignment-table"><caption>Confusion matrix — counts on the test split</caption><thead><tr><th>Observed outcome</th><th>Predicted on time</th><th>Predicted late</th></tr></thead><tbody><tr><th>Actually on time</th><td>{matrix.trueOnTime}</td><td>{matrix.falseLate}</td></tr><tr><th>Actually late</th><td>{matrix.falseOnTime}</td><td>{matrix.trueLate}</td></tr></tbody></table></div>
    <p className="lab-disclosure">Synthetic holdout from the same simulator, not a real railway test dataset. These results do not establish real-world accuracy or calibration.</p>
    <details><summary>Model identity and evaluation provenance</summary><p>Model: {report.modelVersion}<br />Evaluated: {new Date(evidence.evaluatedAt).toLocaleString()}<br />Source: {report.dataSource}</p><p className="model-hash">{report.trainingDataHash}</p><ul>{report.limitations.map(item => <li key={item}>{item}</li>)}</ul></details>
  </>;
}
