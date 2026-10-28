// External JSON-RPC nodes may return a transaction hash before mining it.
// Wait for receipts in both local-node and in-process contract tests.
const assert = require("node:assert/strict");
const { ethers } = require("hardhat");
const frozenAbi = require("../../docs/contracts/chainroute-settlement.abi.json");
const errors = new ethers.Interface(frozenAbi);
function settledContract(contract) {
  const wrap = (method, fragment) => {
    if (!fragment || ["view", "pure"].includes(fragment.stateMutability)) return method;
    return new Proxy(method, { apply: async (target, receiver, args) => {
      const transaction = await Reflect.apply(target, receiver, args);
      await transaction.wait(); return transaction;
    } });
  };
  return new Proxy(contract, { get(target, property) {
    if (property === "connect") return runner => settledContract(target.connect(runner));
    if (property === "getFunction") return name => wrap(target.getFunction(name), target.interface.getFunction(name));
    const value = Reflect.get(target, property, target);
    if (typeof value !== "function") return value;
    let fragment; try { fragment = target.interface.getFunction(property); } catch {}
    return fragment ? wrap(value, fragment) : value.bind(target);
  } });
}
async function expectCustomError(action, name) {
  const selector = errors.getError(name).selector.toLowerCase();
  await assert.rejects(action, error => {
    const data = [error.data, error.error?.data, error.info?.error?.data].find(value => typeof value === "string" && value.startsWith("0x"));
    return error.message.includes(name) || data?.toLowerCase().startsWith(selector) || error.message.toLowerCase().includes(selector);
  });
}
module.exports = { settledContract, expectCustomError };
