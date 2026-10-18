export const ROLES = [
  "Shipper",
  "Carrier",
  "Administrator",
  "Auditor",
] as const;

export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "auth.login",
  "orders.create",
  "optimizations.run",
  "plans.accept",
  "plans.read",
  "plans.export",
  "dashboard.summary",
  "contracts.read",
  "contracts.book",
  "contracts.shipment",
  "contracts.delivery",
  "contracts.raiseDispute",
  "contracts.resolveDispute",
  "admin.users",
  "admin.wagons",
  "admin.routes",
  "audit.read",
  "artifact.read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type ResourceScope = {
  shipperId?: string;
  carrierId?: string;
  userId?: string;
};

const ROLE_ACCESS: Record<Permission, readonly Role[]> = {
  "auth.login": ROLES,
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

export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && PERMISSIONS.includes(value as Permission);
}

export function canPerform(
  role: Role,
  permission: Permission,
  actorUserId?: string,
  resource?: ResourceScope,
): boolean {
  if (!ROLE_ACCESS[permission].includes(role)) return false;
  if (!resource) return true;

  if (
    (permission === "plans.read" || permission === "plans.export") &&
    role === "Shipper"
  ) {
    return resource.shipperId === actorUserId;
  }

  if (permission === "contracts.read" || permission === "contracts.raiseDispute") {
    if (role === "Shipper") {
      return resource.shipperId === actorUserId;
    }
    if (role === "Carrier") {
      return resource.carrierId === actorUserId;
    }
  }

  return true;
}
