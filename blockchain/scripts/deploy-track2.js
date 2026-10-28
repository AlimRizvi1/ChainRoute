const fs = require("node:fs/promises");
const path = require("node:path");
const hre = require("hardhat");
const legacyBuild = require("./legacy-settlement-build.json");

async function main() {
  const outputPath =
    process.env.CONTRACT_OUTPUT_PATH || path.join(__dirname, "..", "deployments", "contract.json");
  const artifact = await hre.artifacts.readArtifact("ChainRouteSettlement");
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  let existing;
  try { existing = JSON.parse(await fs.readFile(outputPath, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (existing && existing.chainId === chainId) {
    const code = await hre.ethers.provider.getCode(existing.address);
    if (code !== "0x") {
      const build = await hre.artifacts.getBuildInfo(`${artifact.sourceName}:${artifact.contractName}`);
      const immutableReferences = build.output.contracts[artifact.sourceName][artifact.contractName].evm.deployedBytecode.immutableReferences;
      const normalize = (value, references = immutableReferences) => {
        let hex = value.slice(2).toLowerCase();
        for (const locations of Object.values(references)) for (const { start, length } of locations)
          hex = hex.slice(0, start * 2) + "0".repeat(length * 2) + hex.slice((start + length) * 2);
        return hex;
      };
      const [operator] = await hre.ethers.getSigners();
      const deployed = new hre.ethers.Contract(existing.address, artifact.abi, hre.ethers.provider);
      // The DApp adds an internal creation hook without changing the public legacy
      // lifecycle. Retain only the explicitly fingerprinted pre-DApp local build;
      // arbitrary bytecode and a different operator are still rejected.
      const approvedLegacy = chainId === legacyBuild.chainId &&
        hre.ethers.keccak256(`0x${normalize(code, legacyBuild.immutableReferences)}`) === legacyBuild.normalizedRuntimeHash;
      if ((!approvedLegacy && normalize(code) !== normalize(artifact.deployedBytecode)) || (await deployed.operator()).toLowerCase() !== (await operator.getAddress()).toLowerCase()) {
        throw new Error("Existing settlement bytecode differs from this build. Use a separate development project or an explicit deployment migration.");
      }
      console.log(`Reusing ChainRouteSettlement at ${existing.address}`);
      return;
    }
  }
  const contract = await hre.ethers.deployContract("ChainRouteSettlement");
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  const output = {
    contractName: "ChainRouteSettlement",
    address,
    abi: artifact.abi,
    chainId,
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
