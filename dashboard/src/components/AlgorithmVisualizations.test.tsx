import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import samplePlan from "../../../samples/allocation-plan.json";
import type { Demonstration, Evaluation } from "../api/demonstrations";
import type { AllocationPlan } from "../api/optimization";
import { CpSatVisualization, LogisticVisualization } from "./AlgorithmVisualizations";
// Happy DOM does not implement the SVG matrices needed by GSAP. Browser review
// covers animation; these tests verify calculation provenance and playback state.
vi.mock("@gsap/react", () => ({ useGSAP: () => undefined }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const evidence: Evaluation = { evaluatedAt:"2026-10-21T08:19:10Z", syntheticDeparture:"2026-01-07T20:00:00Z", evaluation: {
  modelVersion:"test-logreg", trainingSamples:24000, testSamples:6000, seed:42, threshold:.5,
  accuracy:.9735, alwaysOnTimeAccuracy:.9091666667, lateRecall:.81651376, probabilityMae:.00977554, brierScore:.01917575,
  onTimePrecision:.98180495, onTimeRecall:.98918423, dataSource:"synthetic", trainingDataHash:"sha256:test", limitations:[],
  confusionMatrix:{trueOnTime:5396,trueLate:445,falseOnTime:100,falseLate:59},
  coefficients:{intercept:.08926747689743683,slackRatio:7.7953638710017445,cargoVariability:-.1665554777286779},
  cargoVariability:{grain:.1,coal:.2,steel:.3} } };
function demonstration(): Demonstration {
  return { synthetic:true, kind:"ml", request:{}, baseline:null, plan:{...samplePlan, runId:"visual-run", assignments:[{...samplePlan.assignments[0],onTimeProbability:.8830311582075702}], runMetadata:{...samplePlan.runMetadata,prediction:{method:"logistic_regression",modelVersion:evidence.evaluation.modelVersion}}} as AllocationPlan };
}
it("uses the live probability and matched coefficients, and withholds the curve for fallback results", () => {
  const result=demonstration();
  const view=render(<LogisticVisualization result={result} evidence={evidence} cargo="grain" slack={.25} />);
  expect(screen.getByText("z = 2.0215")).toBeInTheDocument();
  expect(screen.getByText("88.30%")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:/Pass through the sigmoid/}));
  expect(screen.getByRole("img",{name:/2.0215 maps to 88.30 percent/})).toBeInTheDocument();
  expect(screen.getByRole("button",{name:"Play Logistic Regression"})).toBeInTheDocument();
  result.plan.runMetadata.prediction={method:"heuristic_fallback",modelVersion:null};
  view.rerender(<LogisticVisualization result={result} evidence={evidence} cargo="grain" slack={.25} />);
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(screen.getByText(/animation is withheld/)).toBeInTheDocument();
});
it("allows deterministic stepping through the bottleneck and derives final counts from the returned plan", () => {
  const result=demonstration(); result.kind="cp-sat";
  result.baseline={method:"greedy",assignments:[result.plan.assignments[0]],metrics:result.plan.metrics};
  result.plan.assignments=[{...result.plan.assignments[0],orderId:"ORD-FLEX",wagonIds:["WAG-A"]},{...result.plan.assignments[0],orderId:"ORD-ONLY",wagonIds:["WAG-B"]}];
  render(<CpSatVisualization result={result} />);
  fireEvent.click(screen.getByRole("button",{name:/Expose the conflict/}));
  expect(screen.getByRole("heading",{name:"Expose the conflict"})).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:/Read the engine’s result/}));
  expect(screen.getByText(/1 baseline load\(s\) → 2 load\(s\)/)).toBeInTheDocument();
  expect(screen.getByRole("button",{name:"Next CP-SAT step"})).toBeDisabled();
  fireEvent.click(screen.getByRole("button",{name:"Previous CP-SAT step"}));
  expect(screen.getByRole("heading",{name:"Allocate the flexible load"})).toBeInTheDocument();
});
it("respects reduced motion while keeping manual steps available", () => {
  vi.spyOn(window,"matchMedia").mockReturnValue({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()} as unknown as MediaQueryList);
  render(<CpSatVisualization result={demonstration()} />);
  expect(screen.getByRole("checkbox",{name:"Motion"})).not.toBeChecked();
  expect(screen.getByRole("button",{name:"Play CP-SAT"})).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Next CP-SAT step"}));
  expect(screen.getByRole("heading",{name:"Try the shortest route"})).toBeInTheDocument();
});
