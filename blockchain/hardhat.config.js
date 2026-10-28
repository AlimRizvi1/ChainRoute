require("@nomicfoundation/hardhat-ethers");
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");

// Compile with the lockfile-pinned npm compiler, including on machines where
// binaries.soliditylang.org is unreachable. No runtime compiler download.
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD).setAction(async ({ solcVersion }, _hre, runSuper) => {
  if (solcVersion !== "0.8.28") return runSuper();
  return { compilerPath: require.resolve("solc/soljson.js"), isSolcJs: true,
    version: solcVersion, longVersion: require("solc").version() };
});

module.exports = {
  solidity: "0.8.28",
  networks: {
    local: {
      url: process.env.CHAIN_RPC_URL || "http://127.0.0.1:8545",
      chainId: 31337,
    },
  },
};
