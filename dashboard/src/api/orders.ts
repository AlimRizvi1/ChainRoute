import { apiRequest } from "./client";

export type FreightOrder = {
  orderId: string; cargoType: string; quantityTonnes: number; destination: string;
  priority: number; deadline: string; status: "Pending" | "Planned"; createdAt: string;
};
export type OrderList = { items: FreightOrder[]; total: number; nextOffset: number | null };
export function listOrders(status: string, offset: number, signal?: AbortSignal) {
  const query = new URLSearchParams({ limit: "20", offset: String(offset) });
  if (status) query.set("status", status);
  return apiRequest<OrderList>(`/orders?${query}`, { signal });
}
