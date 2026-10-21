import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { listOrders } from "../api/orders";
import { createOrder } from "../api/optimization";
import { OrdersPage } from "./OrdersPage";

vi.mock("../api/orders", () => ({ listOrders: vi.fn() }));
vi.mock("../api/optimization", () => ({ createOrder: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const order = { orderId: "ORD-101", cargoType: "grain", quantityTonnes: 20, destination: "Port-A", priority: 1, deadline: "2026-11-10T10:00:00Z", createdAt: "2026-10-21T10:00:00Z", status: "Pending" as const };
const mount = () => render(<MemoryRouter><OrdersPage /></MemoryRouter>);

it("shows database orders, filters and paginates", async () => {
  vi.mocked(listOrders).mockResolvedValue({ items: [order], total: 21, nextOffset: 20 });
  mount();
  expect(await screen.findByText("ORD-101")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() => expect(listOrders).toHaveBeenLastCalledWith("", 20, expect.any(AbortSignal)));
  fireEvent.change(screen.getByLabelText("Status"), { target: { value: "Planned" } });
  await waitFor(() => expect(listOrders).toHaveBeenLastCalledWith("Planned", 0, expect.any(AbortSignal)));
});

it("retries a failed order list", async () => {
  vi.mocked(listOrders).mockRejectedValueOnce(new Error("Orders offline")).mockResolvedValue({ items: [], total: 0, nextOffset: null });
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("Orders offline");
  fireEvent.click(screen.getByRole("button", { name: "Retry orders" }));
  expect(await screen.findByText(/No orders match/)).toBeInTheDocument();
});

it("refreshes the register after creating freight", async () => {
  vi.mocked(listOrders).mockResolvedValue({ items: [], total: 0, nextOffset: null });
  vi.mocked(createOrder).mockResolvedValue({ orderId: "ORD-101", status: "Pending" });
  mount();
  await screen.findByText(/No orders match/);
  fireEvent.change(screen.getByLabelText("Cargo type"), { target: { value: "grain" } });
  fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: "20" } });
  fireEvent.change(screen.getByLabelText("Destination"), { target: { value: "Port-A" } });
  vi.mocked(listOrders).mockResolvedValue({ items: [order], total: 1, nextOffset: null });
  fireEvent.change(screen.getByLabelText("Required by"), { target: { value: "2026-11-10T10:00" } });
  fireEvent.submit(screen.getByLabelText("Cargo type").closest("form")!);
  expect(await screen.findByText("ORD-101")).toBeInTheDocument();
  expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ quantityTonnes: 20, cargoType: "grain", destination: "Port-A" }));
});
