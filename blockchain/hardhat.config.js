require("@nomicfoundation/hardhat-ethers");

module.exports = {
  solidity: "0.8.28",
  networks: {
    local: {
      url: process.env.CHAIN_RPC_URL || "http://127.0.0.1:8545",
      chainId: 31337,
    },
  },
};
