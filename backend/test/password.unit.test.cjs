const assert = require("node:assert/strict");
const test = require("node:test");

const { hashPassword, verifyPassword } = require("../dist/auth/password.js");

test("password hashes use unique random salts and verify without storing plaintext", async () => {
  const first = await hashPassword("sample-secret-for-test");
  const second = await hashPassword("sample-secret-for-test");
  assert.notEqual(first, second);
  assert.match(first, /^scrypt\$131072\$8\$1\$/);
  assert.equal(await verifyPassword("sample-secret-for-test", first), true);
  assert.equal(await verifyPassword("wrong-password", first), false);
  assert.equal(first.includes("sample-secret-for-test"), false);
});

test("password input and stored hash formats fail closed", async () => {
  await assert.rejects(hashPassword(""), /1–256/);
  assert.equal(await verifyPassword("x".repeat(257), "bad-hash"), false);
  assert.equal(await verifyPassword("password", "bad-hash"), false);
});
