import { useId } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import type { Demonstration, Evaluation } from "../api/demonstrations";
import { TeachingControls, useTeachingPlayback } from "./TeachingPlayback";
import "./algorithm-visualizations.css";

gsap.registerPlugin(useGSAP);
const cpSteps = [
  ["Read the yard", "Two 20-tonne loads. Two compatible 20-tonne wagons. Only one wagon can reach Port-B."],
  ["Try the shortest route", "The greedy baseline sends ORD-FLEX with WAG-B: a one-hour route to Port-A."],
  ["Expose the conflict", "ORD-ONLY also needs WAG-B. A wagon cannot serve two orders in this plan, so this choice strands one load."],
  ["Compare feasible choices", "A different candidate can send the flexible load from Yard-A. There is no Yard-A route to Port-B."],
  ["Reserve the scarce wagon", "The illustrated feasible branch keeps WAG-B available for ORD-ONLY and its one-hour route to Port-B."],
  ["Allocate the flexible load", "WAG-A can cover ORD-FLEX on its three-hour route. Capacity, compatibility and deadlines remain satisfied."],
  ["Read the engine’s result", "The final connections below follow the returned assignments. Learned reliability and the chosen weights rank generated plans."],
];
const mlSteps = ["Read two features", "Apply learned weights", "Add the intercept", "Pass through the sigmoid", "Use the live probability"];

function useDiagramMotion(playback: ReturnType<typeof useTeachingPlayback>) {
  useGSAP(() => {
    if (!playback.motion || !playback.visible || !window.matchMedia) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const edges = playback.root.current?.querySelectorAll(".algorithm-edge.is-active");
      const token = playback.root.current?.querySelector(".algorithm-token");
      const curve = playback.root.current?.querySelector<SVGPathElement>(".sigmoid-curve.is-active");
      const tl = gsap.timeline({ defaults: { duration: .65, ease: "power3.out" } });
      if (edges?.length) tl.fromTo(edges, { strokeDashoffset: 70 }, { strokeDashoffset: 0 }, 0);
      if (curve && typeof curve.getTotalLength === "function") {
        const length = curve.getTotalLength();
        tl.fromTo(curve, { strokeDasharray: length, strokeDashoffset: length }, { strokeDashoffset: 0, duration: .9 }, 0);
      }
      if (token) tl.fromTo(token, { scale: .75, transformOrigin: "center" }, { scale: 1 }, 0);
    });
    return () => media.revert();
  }, { scope: playback.root, dependencies: [playback.step, playback.motion, playback.visible], revertOnUpdate: true });
}

export function CpSatVisualization({ result }: { result: Demonstration | null }) {
  const playback = useTeachingPlayback(cpSteps.length, result?.plan.runId);
  useDiagramMotion(playback);
  const step = playback.step;
  const final = step === 6;
  const assigned = (order: string, wagon: string) => result?.plan.assignments.some(item => item.orderId === order && item.wagonIds.includes(wagon));
  const flexA = final ? assigned("ORD-FLEX", "WAG-A") : step >= 5;
  const flexB = final ? assigned("ORD-FLEX", "WAG-B") : step === 1 || step === 2;
  const onlyB = final ? assigned("ORD-ONLY", "WAG-B") : step >= 4;
  return <div className="algorithm-theatre" ref={playback.root}>
    <div className="algorithm-title"><h3>Watch the allocation decision</h3><span>{result ? "Live result linked" : "Synthetic case preview"}</span></div>
    <p className="algorithm-caption">An illustrative candidate walkthrough, not an internal solver trace. Run the comparison to connect the final frame to actual engine output.</p>
    <div className="algorithm-scroll" tabIndex={0} role="region" aria-label="Wagon assignment visualization. Scroll horizontally on small screens.">
      <svg className="allocation-diagram" viewBox="0 0 760 310" role="img" aria-label="ORD-FLEX can use WAG-A or WAG-B; ORD-ONLY can only use WAG-B.">
        <path className={`algorithm-edge ${flexA ? "is-active" : ""}`} d="M232 86 C350 86 390 86 508 86" />
        <path className={`algorithm-edge ${flexB ? "is-active is-greedy" : ""}`} d="M232 86 C350 86 390 230 508 230" />
        <path className={`algorithm-edge ${onlyB ? "is-active" : step === 2 ? "is-conflict" : ""}`} d="M232 230 C350 230 390 230 508 230" />
        <path className={`algorithm-edge is-unavailable ${step === 3 ? "is-conflict" : ""}`} d="M232 230 C350 230 390 86 508 86" />
        <g className="algorithm-node"><rect x="20" y="45" width="212" height="82" rx="3" /><text x="38" y="74" className="node-title">ORD-FLEX</text><text x="38" y="99">20 t grain → Port-A</text></g>
        <g className={`algorithm-node ${step === 2 ? "has-conflict" : ""}`}><rect x="20" y="189" width="212" height="82" rx="3" /><text x="38" y="218" className="node-title">ORD-ONLY</text><text x="38" y="243">20 t grain → Port-B</text></g>
        <g className={`algorithm-node ${flexA ? "is-assigned" : ""}`}><rect x="508" y="45" width="232" height="82" rx="3" /><text x="526" y="74" className="node-title">WAG-A · YARD-A</text><text x="526" y="99">20 t · 3 h to Port-A</text></g>
        <g className={`algorithm-node ${onlyB || flexB ? "is-assigned" : ""}`}><rect x="508" y="189" width="232" height="82" rx="3" /><text x="526" y="218" className="node-title">WAG-B · YARD-B</text><text x="526" y="243">20 t · 1 h to either port</text></g>
        {step === 2 && <g className="algorithm-token conflict-token"><circle cx="370" cy="230" r="20" /><path d="m363 223 14 14m0-14-14 14" /></g>}
        {step === 3 && <text x="312" y="156" className="route-rejection">No route to Port-B</text>}
        {step >= 4 && <text x="285" y="260" className="route-confirmation">Wagon reserved for ORD-ONLY</text>}
        {step >= 5 && flexA && <text x="305" y="65" className="route-confirmation">Compatible · capacity covered</text>}
      </svg>
    </div>
    <p className="diagram-scroll-hint">Scroll across the yard to inspect the wagon routes.</p>
    <div className="algorithm-narration" aria-live="polite"><span>Step {step + 1} / {cpSteps.length}</span><h4>{cpSteps[step][0]}</h4><p>{final ? result ? `${result.baseline?.assignments.length ?? 0} baseline load(s) → ${result.plan.assignments.length} load(s) in the selected plan. ${cpSteps[step][1]}` : "Run CP-SAT comparison to reveal the actual selected assignments in this frame." : cpSteps[step][1]}</p></div>
    <TeachingControls playback={playback} count={cpSteps.length} label="CP-SAT" />
    <ol className="algorithm-steps" aria-label="CP-SAT walkthrough steps">{cpSteps.map(([label], index) => <li key={label}><button type="button" aria-current={step === index ? "step" : undefined} onClick={() => playback.seek(index)}>{index + 1}<span>{label}</span></button></li>)}</ol>
  </div>;
}

export function LogisticVisualization({ result, evidence, cargo, slack }: {
  result: Demonstration | null; evidence: Evaluation | null; cargo: string; slack: number;
}) {
  const playback = useTeachingPlayback(mlSteps.length, result?.plan.runId);
  useDiagramMotion(playback);
  const clipId = useId();
  const model = evidence?.evaluation;
  const matches = Boolean(model && result?.plan.runMetadata.prediction?.method === "logistic_regression" && result.plan.runMetadata.prediction?.modelVersion === model.modelVersion);
  const variability = model?.cargoVariability[cargo];
  const coefficients = model?.coefficients;
  const supported = Boolean(coefficients && variability !== undefined && (!result || matches));
  const slackTerm = coefficients ? coefficients.slackRatio * slack : 0;
  const cargoTerm = coefficients && variability !== undefined ? coefficients.cargoVariability * variability : 0;
  const z = coefficients ? coefficients.intercept + slackTerm + cargoTerm : 0;
  const liveProbability = result?.plan.assignments[0]?.onTimeProbability;
  const probability = matches && liveProbability !== undefined ? liveProbability : 1 / (1 + Math.exp(-z));
  const pointX = 46 + (Math.max(-6, Math.min(6, z)) + 6) / 12 * 430;
  const pointY = 220 - probability * 174;
  const curve = Array.from({ length: 81 }, (_, i) => { const x = -6 + i * 12 / 80; return `${i ? "L" : "M"}${(46 + i / 80 * 430).toFixed(1)},${(220 - 174 / (1 + Math.exp(-x))).toFixed(1)}`; }).join(" ");
  const narratives = [
    `Deadline slack = ${slack.toFixed(2)}. ${cargo} variability = ${variability ?? "loading"}. These are the model’s two inputs.`,
    `Slack contributes ${slackTerm.toFixed(4)}; cargo variability contributes ${cargoTerm.toFixed(4)}. The weights were learned offline.`,
    `z = ${coefficients?.intercept.toFixed(4) ?? "…"} + ${slackTerm.toFixed(4)} + (${cargoTerm.toFixed(4)}) = ${z.toFixed(4)}.`,
    "The sigmoid maps z to a probability between 0 and 1. The dashed 50% line is the classification threshold used in the saved evaluation.",
    matches ? `The engine returned ${(probability * 100).toFixed(2)}% on-time probability. This scores a candidate assignment; it is not an accuracy measurement.` : "Run the predictor to see the live probability and confirm its model version. The preview uses the saved model’s coefficients.",
  ];
  return <div className="algorithm-theatre" ref={playback.root}>
    <div className="algorithm-title"><h3>Inside Logistic Regression</h3><span>{matches ? "Live model matched" : "Saved-model preview"}</span></div>
    <p className="algorithm-caption">Follow inference from features to probability. Training happens offline; these steps do not retrain the model.</p>
    {model && <p className="model-training-path">{(model.trainingSamples + model.testSamples).toLocaleString()} synthetic outcomes → {model.trainingSamples.toLocaleString()} training examples → saved coefficients → inference. Evaluated separately on {model.testSamples.toLocaleString()} holdout examples.</p>}
    {!supported ? <p className="form-notice">{result ? "This response uses a different model or a fallback. The saved-model animation is withheld so it cannot misrepresent the live prediction." : "Waiting for the saved model’s coefficients…"}</p> : <>
      <div className="logistic-workbench">
        <ol className="feature-calculation" aria-label="Logistic Regression calculation">
          <li className={playback.step >= 0 ? "is-active" : ""}><span>Features</span><strong>slack {slack.toFixed(2)} · variability {variability}</strong></li>
          <li className={playback.step >= 1 ? "is-active" : ""}><span>Learned contributions</span><strong>{slackTerm.toFixed(4)} + ({cargoTerm.toFixed(4)})</strong></li>
          <li className={playback.step >= 2 ? "is-active" : ""}><span>Logit, including intercept</span><strong>z = {z.toFixed(4)}</strong></li>
          <li className={playback.step >= 4 ? "is-active" : ""}><span>{matches ? "Live on-time probability" : "Saved-model preview probability"}</span><strong>{(probability * 100).toFixed(2)}%</strong></li>
        </ol>
        <div className="sigmoid-plot"><svg viewBox="0 0 500 270" role="img" aria-label={`Sigmoid probability curve. Logit ${z.toFixed(4)} maps to ${(probability * 100).toFixed(2)} percent.`}>
          <defs><clipPath id={clipId}><rect x="45" y="35" width="434" height="188" /></clipPath></defs>
          <path className="plot-axis" d="M46 38V220H480" /><path className="plot-threshold" d="M46 133H476" />
          <text x="3" y="50">100%</text><text x="9" y="138">50%</text><text x="19" y="222">0%</text><text x="40" y="246">−6</text><text x="254" y="246">0</text><text x="461" y="246">+6</text><text x="210" y="266">Logit z</text>
          <path className={`sigmoid-curve algorithm-edge ${playback.step >= 3 ? "is-active" : ""}`} d={curve} clipPath={`url(#${clipId})`} />
          {playback.step >= 3 && <g className="algorithm-token"><path className="plot-marker-guide" d={`M${pointX} 220V${pointY}H46`} /><circle className="probability-marker" cx={pointX} cy={pointY} r="7" /></g>}
        </svg><p>p = 1 / (1 + exp(−z))</p></div>
      </div>
      <div className="algorithm-narration" aria-live="polite"><span>Step {playback.step + 1} / {mlSteps.length}</span><h4>{mlSteps[playback.step]}</h4><p>{narratives[playback.step]}</p></div>
      <TeachingControls playback={playback} count={mlSteps.length} label="Logistic Regression" />
      <ol className="algorithm-steps" aria-label="Logistic Regression inference steps">{mlSteps.map((label, index) => <li key={label}><button type="button" aria-current={playback.step === index ? "step" : undefined} onClick={() => playback.seek(index)}>{index + 1}<span>{label}</span></button></li>)}</ol>
    </>}
  </div>;
}
