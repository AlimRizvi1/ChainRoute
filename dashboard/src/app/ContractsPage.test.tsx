import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { AuthProvider } from "../auth/context";
import { writeSession } from "../auth/session";
import { ApiError } from "../api/errors";
import { getContract, listContracts, performContractAction, type ContractDetail, type ContractSummary } from "../api/contracts";
import { availableActions, ContractsPage } from "./ContractsPage";

vi.mock("../api/contracts", async (importOriginal) => ({ ...(await importOriginal<typeof import("../api/contracts")>()), getContract: vi.fn(), listContracts: vi.fn(), performContractAction: vi.fn() }));

const detail: ContractDetail = {
  contractId: "2045", planId: "plan-45", state: "Created", shipperId: "shipper-1", carrierId: "carrier-1",
  terms: { freightValuePaise: "2500000", slaDeadline: "2026-11-02T18:00:00Z", penaltyBpsPerBlock: 100, penaltyBlockSeconds: 3600, freeHoldingHours: 4, demurrageRatePaisePerWagonHour: "5000", wagonCount: 2 },
  termsHash: `0x${"a".repeat(64)}`, assignments: [{ orderId: "ORD-1", cargoType: "grain", quantityTonnes: 40, wagonIds: ["WAG-1", "WAG-2"], route: { routeId: "R-1", origin: "Yard-A", destination: "Port-A" }, departAt: "2026-10-31T08:00:00Z", eta: "2026-11-01T08:00:00Z", onTimeProbability: 0.9 }],
  penaltyPaise: "0", demurragePaise: "0", netPaymentPaise: "2500000",
  history: [
    { action: "BookingConfirmed", actor: `0x${"2".repeat(40)}`, timestamp: "2026-10-30T09:00:00Z", dataHash: `0x${"d".repeat(64)}` },
    { action: "AgreementCreated", actor: `0x${"1".repeat(40)}`, timestamp: "2026-10-30T08:00:00Z", dataHash: `0x${"c".repeat(64)}` },
  ],
};
const contracts: ContractSummary[] = Array.from({ length: 20 }, (_, index) => ({ contractId: String(2000 + index), planId: `plan-${index}`, state: index % 2 ? "InTransit" : "Created", shipperId: "shipper-1", carrierId: "carrier-1" }));

function mount(path: string, role: "Shipper" | "Carrier" | "Administrator" | "Auditor" = "Shipper") {
  writeSession({ token: "contracts-test-token", expiresAt: Date.now() + 60_000, user: { id: `${role.toLowerCase()}-1`, username: `demo.${role.toLowerCase()}`, role } });
  return render(<MemoryRouter initialEntries={[path]}><AuthProvider><Routes><Route path="/contracts" element={<ContractsPage />} /><Route path="/contracts/:contractId" element={<ContractsPage />} /></Routes></AuthProvider></MemoryRouter>);
}

afterEach(() => { cleanup(); vi.clearAllMocks(); sessionStorage.clear(); });

function stubDownloads() {
  const original = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  const createObjectURL = vi.fn(() => "blob:chainroute-test");
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
  return { createObjectURL, restore: () => original ? Object.defineProperty(URL, "createObjectURL", original) : Reflect.deleteProperty(URL, "createObjectURL") };
}

describe("contract ledger", () => {
  it("searches a long ledger and filters by lifecycle state", async () => {
    vi.mocked(listContracts).mockResolvedValue({ items: contracts, nextCursor: null });
    mount("/contracts");
    expect(await screen.findByText("2019")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /CONTRACT/ }).length).toBe(20);
    fireEvent.change(screen.getByLabelText("Find a contract"), { target: { value: "plan-13" } });
    expect(screen.getByRole("link", { name: /2013/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /2012/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Find a contract"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Lifecycle state"), { target: { value: "InTransit" } });
    await waitFor(() => expect(listContracts).toHaveBeenLastCalledWith({ state: "InTransit" }));
  });

  it("shows party terms, ordered event history, and available Carrier actions", async () => {
    vi.mocked(getContract).mockResolvedValue(detail);
    mount("/contracts/2045", "Carrier");
    expect(await screen.findByRole("heading", { name: "Contract 2045" })).toBeInTheDocument();
    expect(screen.getAllByText("₹25,000.00").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Committed assignments")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm booking" })).toBeInTheDocument();
    const eventNames = screen.getAllByText(/Agreement Created|Booking Confirmed/).map((node) => node.textContent);
    expect(eventNames).toEqual(["Agreement Created", "Booking Confirmed"]);
    expect(screen.getByText(new RegExp(`0x${"1".repeat(40)}`))).toBeInTheDocument();
    expect(screen.getByText(`0x${"c".repeat(64)}`)).toBeInTheDocument();
  });

  it("keeps Auditor details redacted and read only", async () => {
    vi.mocked(getContract).mockResolvedValue({ contractId: "2045", planId: "plan-45", state: "Created", shipperId: "shipper-1", carrierId: "carrier-1", history: [{ action: "AgreementCreated", actor: `0x${"1".repeat(40)}`, timestamp: "2026-10-30T08:00:00Z", dataHash: `0x${"c".repeat(64)}` }] });
    mount("/contracts/2045", "Auditor");
    expect(await screen.findByText("Commercial terms are private to the contract parties.")).toBeInTheDocument();
    expect(screen.getByText("Auditor view is read-only.")).toBeInTheDocument();
    expect(screen.getByText("Agreement Created")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Confirm|Raise|Resolve|Release|Close/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/₹25,000/)).not.toBeInTheDocument();
  });

  it("shows planned arrival against the SLA and labels it as a plan estimate", async () => {
    vi.mocked(getContract).mockResolvedValue({ ...detail, state: "InTransit", history: [{ ...detail.history![0], action: "ShipmentStatusUpdated", details: { status: "CheckpointReached", timestamp: "2026-10-31T12:00:00Z" } }] });
    mount("/contracts/2045", "Carrier");
    expect(await screen.findByRole("heading", { name: "Shipment tracking" })).toBeInTheDocument();
    expect(screen.getByText("Within SLA plan")).toBeInTheDocument();
    expect(screen.getByText("Checkpoint")).toBeInTheDocument();
    expect(screen.getByText(/latest immutable plan assignment, not a live location estimate/)).toBeInTheDocument();
    expect(screen.getAllByText(/1 Nov 2026/)).toHaveLength(2);
  });

  it("renders the vector-F settlement from API paise values and event quantities", async () => {
    vi.mocked(getContract).mockResolvedValue({
      ...detail,
      state: "PenaltyCalculated",
      terms: { ...detail.terms!, freightValuePaise: "2500000", slaDeadline: "2026-11-01T18:00:00Z", penaltyBpsPerBlock: 200, penaltyBlockSeconds: 21600, freeHoldingHours: 6, demurrageRatePaisePerWagonHour: "500", wagonCount: 12 },
      assignments: detail.assignments!.map((assignment) => ({ ...assignment, eta: "2026-11-02T15:00:00Z" })),
      penaltyPaise: "150000", demurragePaise: "24000", netPaymentPaise: "2326000",
      history: [
        { action: "DeliveryConfirmed", actor: `0x${"2".repeat(40)}`, timestamp: "2026-11-02T07:00:00Z", dataHash: `0x${"e".repeat(64)}`, details: { timestamp: "2026-11-02T07:00:00Z" } },
        { action: "PenaltyCalculated", actor: `0x${"1".repeat(40)}`, timestamp: "2026-11-02T07:00:01Z", dataHash: `0x${"f".repeat(64)}`, details: { penaltyPaise: "150000", secondsLate: "46800" } },
        { action: "DemurrageCalculated", actor: `0x${"1".repeat(40)}`, timestamp: "2026-11-02T07:00:02Z", dataHash: `0x${"a".repeat(64)}`, details: { demurragePaise: "24000", heldSeconds: "36000" } },
      ],
    });
    mount("/contracts/2045", "Shipper");
    expect(await screen.findByText("Delivered after SLA")).toBeInTheDocument();
    expect(screen.getByText("3 blocks × 200 BPS per 6-hour block")).toBeInTheDocument();
    expect(screen.getByText("12 wagons × 4 billable hours × ₹5.00 per wagon-hour")).toBeInTheDocument();
    expect(screen.getAllByText("₹25,000.00")).toHaveLength(2);
    expect(screen.getByText("₹1,500.00")).toBeInTheDocument();
    expect(screen.getByText("₹240.00")).toBeInTheDocument();
    expect(screen.getByText("₹23,260.00")).toBeInTheDocument();
    expect(screen.getByText(/does not calculate settlement money/)).toBeInTheDocument();
  });

  it("exports settlement rows only after the exact amounts have loaded", async () => {
    const downloads = stubDownloads();
    vi.mocked(getContract).mockResolvedValue({ ...detail, state: "PenaltyCalculated" });
    mount("/contracts/2045", "Shipper");
    const exportButton = await screen.findByRole("button", { name: "Export settlement CSV" });
    expect(exportButton).toBeEnabled();
    fireEvent.click(exportButton);
    expect(downloads.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    downloads.restore();
  });

  it("renders an ownership-safe not-found message for an inaccessible detail", async () => {
    vi.mocked(getContract).mockRejectedValue(new ApiError(404, { code: "NOT_FOUND", message: "Contract was not found." }));
    mount("/contracts/9999", "Shipper");
    expect(await screen.findByRole("heading", { name: "Contract unavailable" })).toBeInTheDocument();
    expect(screen.getByText("This contract was not found or is outside your account’s access.")).toBeInTheDocument();
  });

  it("reports a rejected action without changing the displayed contract state", async () => {
    vi.mocked(getContract).mockResolvedValue(detail);
    vi.mocked(performContractAction).mockRejectedValue(new ApiError(409, { code: "CONTRACT_STATE_CONFLICT", message: "Contract state has changed; refresh and retry." }));
    mount("/contracts/2045", "Carrier");
    fireEvent.click(await screen.findByRole("button", { name: "Confirm booking" }));
    fireEvent.click(screen.getByRole("button", { name: "Record booking" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Contract state has changed");
    expect(screen.getAllByText("Created", { selector: ".contract-state-badge" }).length).toBeGreaterThan(0);
    expect(performContractAction).toHaveBeenCalledTimes(1);
  });

  it("updates state in place after a successful action", async () => {
    vi.mocked(getContract).mockResolvedValueOnce(detail).mockResolvedValueOnce({ ...detail, state: "Booked" });
    vi.mocked(performContractAction).mockResolvedValue({ contractId: "2045", state: "Booked" });
    mount("/contracts/2045", "Carrier");
    fireEvent.click(await screen.findByRole("button", { name: "Confirm booking" }));
    fireEvent.click(screen.getByRole("button", { name: "Record booking" }));
    await waitFor(() => expect(screen.getAllByText("Booked", { selector: ".contract-state-badge" }).length).toBeGreaterThan(0));
    expect(screen.getByRole("status")).toHaveTextContent("updated");
  });

  it("gates every action by its backend role and lifecycle state", () => {
    expect(availableActions("Created", "Carrier")).toEqual(["confirm-booking"]);
    expect(availableActions("Created", "Shipper")).toEqual([]);
    expect(availableActions("Booked", "Carrier")).toEqual(["shipment-status"]);
    expect(availableActions("InTransit", "Carrier")).toEqual(["shipment-status", "confirm-delivery"]);
    expect(availableActions("PenaltyCalculated", "Shipper")).toEqual(["dispute"]);
    expect(availableActions("PenaltyCalculated", "Carrier")).toEqual(["dispute"]);
    expect(availableActions("PenaltyCalculated", "Administrator")).toEqual(["release-payment"]);
    expect(availableActions("Disputed", "Administrator")).toEqual(["resolve-dispute"]);
    expect(availableActions("PaymentReleased", "Administrator")).toEqual(["close"]);
    expect(availableActions("Disputed", "Auditor")).toEqual([]);
  });
});
