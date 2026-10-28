const fs = require("node:fs/promises");
const path = require("node:path");
const hre = require("hardhat");

async function main() {
  const artifact = await hre.artifacts.readArtifact("ChainRouteFreightDApp");
  const info = await hre.artifacts.getBuildInfo(`${artifact.sourceName}:${artifact.contractName}`);
  const compiled = info.output.contracts[artifact.sourceName][artifact.contractName];
  const output = process.env.DAPP_BUILD_OUTPUT || path.join(__dirname, "../deployments/dapp-build.json");
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify({
    contractName: artifact.contractName, abi: artifact.abi, bytecode: artifact.bytecode,
    deployedBytecode: artifact.deployedBytecode,
    immutableReferences: compiled.evm.deployedBytecode.immutableReferences,
    compilerVersion: info.solcLongVersion, sourceName: artifact.sourceName,
    standardInput: info.input,
  }));
  console.log(`Exported wallet deployment build to ${output}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
