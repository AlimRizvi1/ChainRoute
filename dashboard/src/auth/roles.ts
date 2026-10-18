export const ROLES = ["Shipper", "Carrier", "Administrator", "Auditor"] as const;

export type Role = (typeof ROLES)[number];
export type Permission =
  | "orders.create"
  | "optimizations.run"
  | "plans.accept"
  | "plans.read"
  | "plans.export"
  | "dashboard.summary"
  | "contracts.read"
  | "contracts.book"
  | "contracts.shipment"
  | "contracts.delivery"
  | "contracts.raiseDispute"
  | "contracts.resolveDispute"
  | "admin.users"
  | "admin.wagons"
  | "admin.routes"
  | "audit.read"
  | "artifact.read";

const ROLE_ACCESS: Record<Permission, readonly Role[]> = {
  "orders.create": ["Shipper", "Administrator"],
  "optimizations.run": ["Shipper", "Administrator"],
  "plans.accept": ["Shipper", "Administrator"],
  "plans.read": ["Shipper", "Administrator"],
  "plans.export": ["Shipper", "Administrator"],
  "dashboard.summary": ["Shipper", "Administrator"],
  "contracts.read": ROLES,
  "contracts.book": ["Carrier"],
  "contracts.shipment": ["Carrier"],
  "contracts.delivery": ["Carrier"],
  "contracts.raiseDispute": ["Shipper", "Carrier", "Administrator"],
  "contracts.resolveDispute": ["Administrator"],
  "admin.users": ["Administrator"],
  "admin.wagons": ["Administrator"],
  "admin.routes": ["Administrator"],
  "audit.read": ["Administrator", "Auditor"],
  "artifact.read": ROLES,
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && ROLES.includes(value as Role);
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_ACCESS[permission].includes(role);
}

export type NavigationItem = {
  label: string;
  href: string;
  permission?: Permission;
};

export const NAVIGATION: readonly NavigationItem[] = [
  { label: "Overview", href: "/overview" },
  { label: "Freight orders", href: "/orders", permission: "orders.create" },
  { label: "Allocations", href: "/allocations", permission: "plans.read" },
  { label: "Contracts", href: "/contracts", permission: "contracts.read" },
  { label: "Audit trail", href: "/audit", permission: "audit.read" },
  { label: "Administration", href: "/admin", permission: "admin.users" },
];

export function navigationForRole(role: Role): NavigationItem[] {
  return NAVIGATION.filter(
    (item) => !item.permission || hasPermission(role, item.permission),
  );
}

export function canVisit(role: Role, pathname: string): boolean {
  const item = NAVIGATION.find((candidate) => candidate.href === pathname);
  return Boolean(item && (!item.permission || hasPermission(role, item.permission)));
}
