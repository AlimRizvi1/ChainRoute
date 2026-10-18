import { describe, expect, it } from "vitest";
import { encodeCsv, planCsv, safeCsvFilename, settlementCsv } from "./csv";
import type { ContractDetail } from "./contracts";
import type { AllocationPlan } from "./optimization";

describe("CSV exports", () => {
  it("quotes delimiters, newlines, and quotes while keeping formula-like values inert", () => {
    expect(encodeCsv(["Order", "Destination"], [["=1+1", 'Port, "A"\nGate']]))
      .toBe('"Order","Destination"\r\n"\'=1+1","Port, ""A""\nGate"');
  });

  it("exports the rows shown in an allocation table and sanitizes its filename", () => {
    const plan: AllocationPlan = {
      planId: "plan-1", runId: "run-1", score: 0.8,
      assignments: [{ orderId: "ORD-1", cargoType: "grain", quantityTonnes: 40, wagonIds: ["WAG-1", "WAG-2"], route: { routeId: "RTE-1", origin: "Yard A", destination: "Port A" }, departAt: "2026-01-01T00:00:00Z", eta: "2026-01-01T04:00:00Z", onTimeProbability: 0.8 }],
      unassignedOrders: [], alternatives: [], metrics: { utilizationPercent: 80, estimatedCostPaise: "120000", distanceKm: 100, onTimeProbability: 0.8 },
      runMetadata: { generatedAt: "2026-01-01T00:00:00Z", durationMs: 42, algorithm: "test", weights: { onTime: 0.5, cost: 0.3, utilization: 0.2 } },
    };
    expect(planCsv(plan).split("\r\n")).toHaveLength(2);
    expect(planCsv(plan)).toContain('"ORD-1","grain","40","WAG-1; WAG-2"');
    expect(safeCsvFilename("plan/with spaces", "plan")).toBe("plan-with-spaces-plan.csv");
  });

  it("exports exact integer-paise settlement amounts and derived explanations", () => {
    const detail = {
      contractId: "2044", planId: "plan-1", state: "PenaltyCalculated", shipperId: "shipper-1", carrierId: "carrier-1",
      terms: { freightValuePaise: "2500000", slaDeadline: "2026-01-01T00:00:00Z", penaltyBpsPerBlock: 200, penaltyBlockSeconds: 21600, freeHoldingHours: 6, demurrageRatePaisePerWagonHour: "500", wagonCount: 12 },
      penaltyPaise: "150000", demurragePaise: "24000", netPaymentPaise: "2326000",
      history: [
        { action: "PenaltyCalculated", actor: "0x1", timestamp: "2026-01-01T00:00:00Z", dataHash: "0x1", details: { secondsLate: "46800" } },
        { action: "DemurrageCalculated", actor: "0x1", timestamp: "2026-01-01T00:00:00Z", dataHash: "0x2", details: { heldSeconds: "36000" } },
      ],
    } satisfies ContractDetail;
    const csv = settlementCsv(detail);
    expect(csv).toContain('"Penalty","150000","₹1,500.00","3 blocks × 200 BPS per 21600 seconds"');
    expect(csv).toContain('"Demurrage","24000","₹240.00","12 wagons × 4 billable hours × 500 paise per wagon-hour"');
    expect(csv).toContain('"Net payable","2326000","₹23,260.00"');
  });
});
