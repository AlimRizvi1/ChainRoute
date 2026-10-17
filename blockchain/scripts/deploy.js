const fs = require("node:fs/promises");
const path = require("node:path");
const hre = require("hardhat");

async function main() {
  const contract = await hre.ethers.deployContract("ChainRouteSettlement");
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  const artifact = await hre.artifacts.readArtifact("ChainRouteSettlement");
  const outputPath =
    process.env.CONTRACT_OUTPUT_PATH ||
    path.join(__dirname, "..", "deployments", "local.json");
  const output = {
    contractName: "ChainRouteSettlement",
    address,
    abi: artifact.abi,
    chainId: Number((await hre.ethers.provider.getNetwork()).chainId),
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`Deployed ChainRouteSettlement at ${address}`);
  console.log(`Wrote address and ABI to ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
