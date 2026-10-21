import { apiRequest } from "./client";
import type { AllocationPlan } from "./optimization";

export type DemoOptions = { kind: "cp-sat" | "ml"; cargo?: "grain" | "coal" | "steel"; slackRatio?: 0 | 0.25 | 0.5 };
export type Demonstration = {
  synthetic: boolean; kind: DemoOptions["kind"]; request: unknown; plan: AllocationPlan;
  baseline: { method: string; assignments: AllocationPlan["assignments"]; metrics: AllocationPlan["metrics"] } | null;
};
export type Evaluation = {
  evaluatedAt: string; syntheticDeparture: string;
  evaluation: {
    modelVersion: string; trainingSamples: number; testSamples: number; seed: number; threshold: number;
    accuracy: number; alwaysOnTimeAccuracy: number; lateRecall: number; probabilityMae: number; brierScore: number;
    onTimePrecision: number; onTimeRecall: number; dataSource: string; trainingDataHash: string;
    confusionMatrix: { trueOnTime: number; trueLate: number; falseOnTime: number; falseLate: number };
    coefficients: { intercept: number; slackRatio: number; cargoVariability: number };
    cargoVariability: Record<string, number>; limitations: string[];
  };
};
export const getEvaluation = (signal?: AbortSignal) => apiRequest<Evaluation>("/ai/demonstrations/evaluation", { signal });
export const runDemonstration = (options: DemoOptions) => apiRequest<Demonstration>("/ai/demonstrations/run", { method: "POST", body: options, signal: AbortSignal.timeout(25000) });
