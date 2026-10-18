import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { AuthProvider } from "../auth/context";
import { writeSession } from "../auth/session";
import { OverviewPage } from "./OverviewPage";
import { getOverview, type OverviewData } from "../api/overview";

vi.mock("../api/overview", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/overview")>();
  return { ...actual, getOverview: vi.fn() };
});

const data: OverviewData = {
  summary: {
    pendingOrders: 12, activeContracts: 8, deliveredContracts: 17, pendingPayments: 3,
    wagonUtilizationPercent: 74, allocationsToday: 5, utilizationTrend: [58, 62, 60, 68, 65, 71, 74],
  },
  contracts: [
    { contractId: "CR-2048", planId: "plan-1", state: "InTransit", shipperId: "s", carrierId: "c" },
    { contractId: "CR-2046", planId: "plan-2", state: "Disputed", shipperId: "s", carrierId: "c" },
  ],
  sampleData: true,
};

function mount() {
  writeSession({
    token: "overview-test-token", expiresAt: Date.now() + 60_000,
    user: { id: "shipper-1", username: "demo.shipper", role: "Shipper" },
  });
  return render(<MemoryRouter><AuthProvider><OverviewPage /></AuthProvider></MemoryRouter>);
}

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); sessionStorage.clear(); });

describe("overview screen", () => {
  it("shows operational KPIs, confirmed movement, and bounded attention links", async () => {
    vi.mocked(getOverview).mockResolvedValue(data);
    mount();

    expect(await screen.findByRole("heading", { name: "Freight, in motion." })).toBeInTheDocument();
    expect(screen.getByText("Orders in queue")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /1 shipment moving through/ })).toBeInTheDocument();
    expect(screen.getByText("Dispute needs review")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Sample network");
  });

  it("refreshes on its timer without manual input", async () => {
    vi.mocked(getOverview).mockResolvedValue(data);
    vi.useFakeTimers();
    mount();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(getOverview).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(15_000); await Promise.resolve(); await Promise.resolve(); });
    expect(getOverview).toHaveBeenCalledTimes(2);
  });
});
