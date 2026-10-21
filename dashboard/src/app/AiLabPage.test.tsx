import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import samplePlan from "../../../samples/allocation-plan.json";
import type { AllocationPlan } from "../api/optimization";
import type { Evaluation } from "../api/demonstrations";
const evidence: Evaluation = {"evaluatedAt": "2026-10-21T08:19:10.465387+00:00", "evaluation": {"modelVersion": "logreg-fd10e2acfde0639b", "trainingDataHash": "sha256:b7a614214577ab84d4ea1d96ba35b87abe1e113b76e19676f134761aac99eff4", "dataSource": "synthetic_lognormal_transit_simulation", "seed": 42, "trainingSamples": 24000, "testSamples": 6000, "threshold": 0.5, "probabilityMae": 0.009775544874902413, "brierScore": 0.019175747325836927, "accuracy": 0.9735, "alwaysOnTimeAccuracy": 0.9091666666666667, "onTimePrecision": 0.9818049490538574, "onTimeRecall": 0.9891842346471127, "lateRecall": 0.8165137614678899, "confusionMatrix": {"trueOnTime": 5396, "trueLate": 445, "falseOnTime": 100, "falseLate": 59}, "coefficients": {"intercept": 0.08926747689743683, "slackRatio": 7.7953638710017445, "cargoVariability": -0.1665554777286779}, "cargoVariability": {"coal": 0.2, "grain": 0.1, "steel": 0.3}, "limitations": ["Synthetic holdout from the same simulator; no real railway test dataset.", "Accuracy uses a 0.5 threshold; probability MAE is not classification accuracy.", "The model uses a fixed synthetic departure: 2026-01-07T20:00:00Z.", "No claim of production accuracy, temporal validation, or real-world calibration."]}, "syntheticDeparture": "2026-01-07T20:00:00+00:00"};
import { getEvaluation, runDemonstration, type Demonstration } from "../api/demonstrations";
import { AiLabPage } from "./AiLabPage";

vi.mock("../api/demonstrations", () => ({ getEvaluation: vi.fn(), runDemonstration: vi.fn() }));
vi.mock("../api/client", () => ({ API_MODE: "real" }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function mount() { vi.mocked(getEvaluation).mockResolvedValue(evidence); return render(<MemoryRouter><AiLabPage /></MemoryRouter>); }
const mlResult = (): Demonstration => ({ synthetic: true, kind: "ml", request: {}, baseline: null, plan: { ...samplePlan, runMetadata: { ...samplePlan.runMetadata, prediction: { method: "logistic_regression", modelVersion: evidence.evaluation.modelVersion } } } as AllocationPlan });

it("shows saved accuracy, baseline, confusion matrix and synthetic limitations", async () => {
  mount();
  expect(await screen.findByText("97.35%")).toBeInTheDocument();
  expect(screen.getByText("90.92%")).toBeInTheDocument();
  expect(screen.getByText("5396")).toBeInTheDocument();
  expect(screen.getByText(/not a real railway test dataset/)).toBeInTheDocument();
});

it("sends chosen ML features to live service and invalidates old result on change", async () => {
  vi.mocked(runDemonstration).mockResolvedValue(mlResult());
  mount(); await screen.findByText("97.35%");
  fireEvent.change(screen.getByLabelText("Cargo"), { target: { value: "coal" } });
  fireEvent.change(screen.getByLabelText("Deadline slack"), { target: { value: "0.25" } });
  fireEvent.click(screen.getByRole("button", { name: "Predict on-time probability" }));
  await screen.findByText("Live engine result");
  expect(runDemonstration).toHaveBeenCalledWith({ kind: "ml", cargo: "coal", slackRatio: 0.25 });
  expect(screen.queryByText(/not yet matched/)).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Deadline slack"), { target: { value: "0.5" } });
  expect(screen.queryByText("Live engine result")).not.toBeInTheDocument();
});

it("does not attribute saved model accuracy to a heuristic fallback", async () => {
  const result = mlResult(); result.plan = structuredClone(result.plan);
  result.plan.runMetadata.prediction = { method: "heuristic_fallback", modelVersion: null };
  vi.mocked(runDemonstration).mockResolvedValue(result);
  mount(); fireEvent.click(screen.getByRole("button", { name: "Predict on-time probability" }));
  expect(await screen.findByText(/not yet matched/)).toBeInTheDocument();
});

it("allows retry after a failed CP-SAT request", async () => {
  vi.mocked(runDemonstration).mockRejectedValue(new Error("AI unavailable"));
  mount(); fireEvent.click(screen.getByRole("button", { name: "Run CP-SAT comparison" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("AI unavailable");
  await waitFor(() => expect(screen.getByRole("button", { name: "Run CP-SAT comparison" })).toBeEnabled());
});
