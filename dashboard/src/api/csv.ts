import type { ContractDetail } from "./contracts";
import type { AllocationPlan } from "./optimization";

export type CsvValue = string | number | null | undefined;

export function encodeCsv(headers: readonly CsvValue[], rows: readonly (readonly CsvValue[])[]): string {
  return [headers, ...rows]
    .map((row) => row.map(encodeCell).join(","))
    .join("\r\n");
}

function encodeCell(value: CsvValue): string {
  const text = String(value ?? "");
  const safe = /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function planCsv(plan: AllocationPlan): string {
  return encodeCsv(
    ["Order ID", "Cargo", "Quantity (tonnes)", "Wagons", "Route ID", "Origin", "Destination", "ETA", "On-time probability"],
    plan.assignments.map((assignment) => [
      assignment.orderId, assignment.cargoType, assignment.quantityTonnes, assignment.wagonIds.join("; "),
      assignment.route.routeId, assignment.route.origin, assignment.route.destination, assignment.eta,
      `${(assignment.onTimeProbability * 100).toFixed(1)}%`,
    ]),
  );
}

export function settlementCsv(detail: ContractDetail): string {
  const penalty = latestEventValue(detail, "PenaltyCalculated", "secondsLate");
  const held = latestEventValue(detail, "DemurrageCalculated", "heldSeconds");
  const block = detail.terms?.penaltyBlockSeconds ?? 0;
  const lateSeconds = parseInteger(penalty);
  const heldSeconds = parseInteger(held);
  const blocks = lateSeconds === null || block < 1 ? "Calculation detail pending" : ((lateSeconds + BigInt(block) - 1n) / BigInt(block)).toString();
  const freeSeconds = BigInt(detail.terms?.freeHoldingHours ?? 0) * 3600n;
  const hours = heldSeconds === null ? "Calculation detail pending" : (heldSeconds <= freeSeconds ? 0n : (heldSeconds - freeSeconds + 3599n) / 3600n).toString();
  const amount = (value: string | undefined) => /^\d+$/.test(value ?? "") ? value! : "Pending";
  const freight = amount(detail.terms?.freightValuePaise);
  const penaltyAmount = amount(detail.penaltyPaise);
  const demurrageAmount = amount(detail.demurragePaise);
  const net = amount(detail.netPaymentPaise);
  return encodeCsv(
    ["Settlement line", "Amount (paise)", "Displayed amount", "Calculation detail", "Status"],
    [
      ["Freight", freight, formatPaiseCsv(freight), "Contract term", detail.state],
      ["Penalty", penaltyAmount, formatPaiseCsv(penaltyAmount), `${blocks} blocks × ${detail.terms?.penaltyBpsPerBlock ?? 0} BPS per ${block} seconds`, detail.state],
      ["Demurrage", demurrageAmount, formatPaiseCsv(demurrageAmount), `${detail.terms?.wagonCount ?? 0} wagons × ${hours} billable hours × ${detail.terms?.demurrageRatePaisePerWagonHour ?? "0"} paise per wagon-hour`, detail.state],
      ["Net payable", net, formatPaiseCsv(net), detail.state === "Disputed" ? "On hold · dispute" : "Recorded by contract API", detail.state],
    ],
  );
}

export function safeCsvFilename(value: string, suffix: string): string {
  const base = value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72) || "chainroute";
  return `${base}-${suffix}.csv`;
}

function latestEventValue(detail: ContractDetail, action: string, key: string): unknown {
  return [...(detail.history ?? [])].reverse().find((event) => event.action === action)?.details?.[key];
}

function parseInteger(value: unknown): bigint | null {
  return typeof value === "string" && /^\d+$/.test(value) ? BigInt(value) : null;
}

function formatPaiseCsv(value: string): string {
  if (!/^\d+$/.test(value)) return "Pending";
  const amount = BigInt(value);
  const whole = amount / 100n;
  const fraction = String(amount % 100n).padStart(2, "0");
  return `₹${new Intl.NumberFormat("en-IN").format(whole)}.${fraction}`;
}
