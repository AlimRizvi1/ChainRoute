import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useParams } from "react-router";
import { AuthProvider } from "../auth/context";
import { writeSession } from "../auth/session";
import type { AllocationPlan } from "../api/optimization";
import { createOrder, runOptimization, acceptPlan } from "../api/optimization";
import { OptimizationPage } from "./OptimizationPage";

vi.mock("../api/optimization", () => ({ createOrder: vi.fn(), runOptimization: vi.fn(), acceptPlan: vi.fn() }));
vi.mock("../api/platform", () => ({ planningResources: vi.fn().mockResolvedValue({ walletMapped: true, carriers: [], yards: [], routes: [] }), loadPlan: vi.fn() }));

const plan = (id: string, onTime: number, cost: string): AllocationPlan => ({
  planId: id, runId: `run-${id}`, score: 0.8, assignments: [{
    orderId: "ORD-1", cargoType: "grain", quantityTonnes: 40, wagonIds: ["WAG-1", "WAG-2"],
    route: { routeId: "RTE-1", origin: "Yard-A", destination: "Port-A" },
    departAt: "2026-11-02T10:00:00Z", eta: "2026-11-03T10:00:00Z", onTimeProbability: onTime,
  }],
  unassignedOrders: [{ orderId: "ORD-2", reasonCode: "INSUFFICIENT_CAPACITY", message: "raw reason" }],
  alternatives: [{ rank: 1, score: 0.7, assignments: [], metrics: { utilizationPercent: 60, estimatedCostPaise: "300000", distanceKm: 450, onTimeProbability: 0.6 } }],
  metrics: { utilizationPercent: 82, estimatedCostPaise: cost, distanceKm: 620, onTimeProbability: onTime },
  runMetadata: { generatedAt: "2026-11-02T09:00:00Z", durationMs: 842, algorithm: "test-cp-sat", weights: { onTime: 0.5, cost: 0.3, utilization: 0.2 } },
});

function ContractReceipt() { const { contractId } = useParams(); return <h1>Contract receipt {contractId}</h1>; }
function mount() {
  writeSession({ token: "optimization-test-token", expiresAt: Date.now() + 60_000, user: { id: "shipper-1", username: "demo.shipper", role: "Shipper" } });
  return render(<MemoryRouter initialEntries={["/allocations"]}><AuthProvider><Routes><Route path="/allocations" element={<OptimizationPage />} /><Route path="/contracts/:contractId" element={<ContractReceipt />} /></Routes></AuthProvider></MemoryRouter>);
}

afterEach(() => { cleanup(); vi.clearAllMocks(); sessionStorage.clear(); });

function stubDownloads() {
  const original = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  const createObjectURL = vi.fn(() => "blob:chainroute-test");
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
  return { createObjectURL, restore: () => original ? Object.defineProperty(URL, "createObjectURL", original) : Reflect.deleteProperty(URL, "createObjectURL") };
}

describe("optimization workshop", () => {
  it("normalizes live weights, runs a what-if, and compares its results", async () => {
    vi.mocked(runOptimization).mockResolvedValueOnce(plan("plan-1", 0.65, "390000")).mockResolvedValueOnce(plan("plan-2", 0.83, "450000"));
    mount();
    expect(screen.getByLabelText("On-time delivery weight")).toHaveValue("0.5");
    fireEvent.click(screen.getByRole("button", { name: /Run allocation/ }));
    expect(await screen.findByRole("heading", { name: "A route worth taking." })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("On-time delivery weight"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Freight cost weight"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Wagon utilization weight"), { target: { value: "0" } });
    expect(screen.getByLabelText(/Normalized weights/)).toHaveAttribute("aria-label", expect.stringContaining("on-time 100%"));
    fireEvent.click(screen.getByRole("button", { name: /Run what-if/ }));
    expect(await screen.findByText("Changed from the previous run")).toBeInTheDocument();
    expect(screen.getAllByText("₹4,500").length).toBeGreaterThanOrEqual(1);
    expect(runOptimization).toHaveBeenCalledTimes(2);
    expect(vi.mocked(runOptimization).mock.calls[1][0]).toEqual({ onTime: 1, cost: 0, utilization: 0 });
    expect(vi.mocked(runOptimization).mock.calls[1][1]).toBe("plan-1");
  });

  it("explains unassigned orders and offers ranked alternatives", async () => {
    vi.mocked(runOptimization).mockResolvedValue(plan("plan-3", 0.7, "400000"));
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Run allocation/ }));
    expect(await screen.findByText("Available wagons do not have enough capacity.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ranked alternatives" })).toBeInTheDocument();
  });

  it("downloads a CSV for the currently displayed plan", async () => {
    const downloads = stubDownloads();
    vi.mocked(runOptimization).mockResolvedValue(plan("plan-export", 0.7, "400000"));
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Run allocation/ }));
    await screen.findByRole("heading", { name: "A route worth taking." });
    fireEvent.click(screen.getByRole("button", { name: "Export plan CSV" }));
    expect(downloads.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    downloads.restore();
  });

  it("submits an order and keeps the run action single-flight", async () => {
    let release!: (value: AllocationPlan) => void;
    vi.mocked(createOrder).mockResolvedValue({ orderId: "ORD-NEW", status: "Pending" });
    vi.mocked(runOptimization).mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    mount();
    fireEvent.change(screen.getByLabelText("Cargo type"), { target: { value: "grain" } });
    fireEvent.change(screen.getByLabelText("Quantity tonnes"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("Destination"), { target: { value: "Port-A" } });
    fireEvent.change(screen.getByLabelText("Required by"), { target: { value: "2026-11-03T12:00" } });
    fireEvent.submit(screen.getByLabelText("Cargo type").closest("form")!);
    expect(await screen.findByText(/ORD-NEW is in the queue/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Run allocation/ }));
    fireEvent.click(screen.getByRole("button", { name: /Finding a route/ }));
    expect(runOptimization).toHaveBeenCalledTimes(1);
    await act(async () => release(plan("plan-slow", 0.7, "400000")));
    await screen.findByRole("heading", { name: "A route worth taking." });
  });

  it("creates a contract once and navigates to its receipt", async () => {
    vi.mocked(runOptimization).mockResolvedValue(plan("plan-accept", 0.7, "400000"));
    vi.mocked(acceptPlan).mockResolvedValue({ contractId: "412", planId: "plan-accept", state: "Created", agreementHash: `0x${"a".repeat(64)}` });
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Run allocation/ }));
    await screen.findByRole("heading", { name: "A route worth taking." });
    fireEvent.change(screen.getByLabelText("Carrier wallet address"), { target: { value: `0x${"1".repeat(40)}` } });
    fireEvent.click(screen.getByRole("button", { name: /Accept & create contract/ }));
    expect(await screen.findByRole("heading", { name: "Contract receipt 412" })).toBeInTheDocument();
    expect(acceptPlan).toHaveBeenCalledTimes(1);
    expect(vi.mocked(acceptPlan).mock.calls[0][1].terms.wagonCount).toBe(2);
    await waitFor(() => expect(acceptPlan).toHaveBeenCalledTimes(1));
  });

  it("keeps queued chain acceptance visible and safely checks the same operation again", async () => {
    vi.mocked(runOptimization).mockResolvedValue(plan("plan-queued", 0.7, "400000"));
    vi.mocked(acceptPlan).mockResolvedValueOnce({ status: "queued", operationId: "operation-1", message: "The blockchain action is queued and will retry automatically." }).mockResolvedValueOnce({ contractId: "413", planId: "plan-queued", state: "Created", agreementHash: `0x${"c".repeat(64)}` });
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Run allocation/ }));
    await screen.findByRole("heading", { name: "A route worth taking." });
    fireEvent.change(screen.getByLabelText("Carrier wallet address"), { target: { value: `0x${"2".repeat(40)}` } });
    fireEvent.click(screen.getByRole("button", { name: /Accept & create contract/ }));
    expect(await screen.findByRole("status")).toHaveTextContent("operation-1");
    fireEvent.click(screen.getByRole("button", { name: /Check agreement status/ }));
    expect(await screen.findByRole("heading", { name: "Contract receipt 413" })).toBeInTheDocument();
    expect(acceptPlan).toHaveBeenCalledTimes(2);
    expect(vi.mocked(acceptPlan).mock.calls[0][0]).toBe(vi.mocked(acceptPlan).mock.calls[1][0]);
  });
});
