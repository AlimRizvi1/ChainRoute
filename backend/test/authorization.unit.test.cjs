const assert = require("node:assert/strict");
const test = require("node:test");

const { canPerform, ROLES } = require("../dist/auth/authorization.js");

test("one data-driven test covers every role and action cell in Appendix A", () => {
  const shipperId = "shipper-1";
  const carrierId = "carrier-1";
  const matrix = [
    { action: "auth.login", allowed: ROLES },
    { action: "orders.create", allowed: ["Shipper", "Administrator"] },
    { action: "optimizations.run", allowed: ["Shipper", "Administrator"] },
    { action: "plans.accept", allowed: ["Shipper", "Administrator"] },
    { action: "dashboard.summary", allowed: ["Shipper", "Administrator"] },
    {
      action: "contracts.read",
      allowed: ROLES,
      context: (role) => ({
        actor: role === "Carrier" ? carrierId : shipperId,
        resource: { shipperId, carrierId },
      }),
    },
    { action: "contracts.book", allowed: ["Carrier"] },
    { action: "contracts.shipment", allowed: ["Carrier"] },
    { action: "contracts.delivery", allowed: ["Carrier"] },
    {
      action: "contracts.raiseDispute",
      allowed: ["Shipper", "Carrier", "Administrator"],
      context: (role) => ({
        actor: role === "Carrier" ? carrierId : shipperId,
        resource: { shipperId, carrierId },
      }),
    },
    { action: "contracts.resolveDispute", allowed: ["Administrator"] },
    {
      action: "admin.manage",
      permissions: ["admin.users", "admin.wagons", "admin.routes"],
      allowed: ["Administrator"],
    },
    { action: "audit.read", allowed: ["Administrator", "Auditor"] },
  ];

  let cells = 0;
  for (const row of matrix) {
    for (const role of ROLES) {
      const { actor, resource } = row.context?.(role) ?? {};
      const permissions = row.permissions ?? [row.action];
      const actual = permissions.every((permission) =>
        canPerform(role, permission, actor, resource),
      );
      assert.equal(actual, row.allowed.includes(role), `${role}: ${row.action}`);
      cells += 1;
    }
  }
  assert.equal(cells, 52);
});

test("ownership and assignment scopes reject another party's contract", () => {
  const resource = { shipperId: "shipper-1", carrierId: "carrier-1" };
  assert.equal(canPerform("Shipper", "contracts.read", "shipper-2", resource), false);
  assert.equal(canPerform("Carrier", "contracts.read", "carrier-2", resource), false);
  assert.equal(canPerform("Shipper", "contracts.read", "shipper-1", {}), false);
  assert.equal(canPerform("Carrier", "contracts.read", "carrier-1", {}), false);
  assert.equal(canPerform("Shipper", "contracts.raiseDispute", "shipper-2", resource), false);
  assert.equal(canPerform("Carrier", "contracts.raiseDispute", "carrier-2", resource), false);
});

test("plan reads and exports are limited to their shipper or an administrator", () => {
  const plan = { shipperId: "shipper-1" };
  assert.equal(canPerform("Shipper", "plans.read", "shipper-1", plan), true);
  assert.equal(canPerform("Shipper", "plans.export", "shipper-2", plan), false);
  assert.equal(canPerform("Administrator", "plans.read", "admin-1", plan), true);
  assert.equal(canPerform("Carrier", "plans.read", "carrier-1", plan), false);
});
