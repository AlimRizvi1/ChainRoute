const fs = require("node:fs/promises");
const path = require("node:path");
const { ethers } = require("hardhat");

const aiEngineUrl = process.env.AI_ENGINE_URL || "http://127.0.0.1:8000";
const chainRpcUrl = process.env.CHAIN_RPC_URL || "http://127.0.0.1:8545";
const requestPath =
  process.env.OPTIMIZE_REQUEST_PATH ||
  process.argv[2] ||
  path.resolve(__dirname, "../../samples/optimize-request.json");
const artifactPath = process.env.CONTRACT_FILE || path.join(__dirname, "..", "deployments", "contract.json");

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function main() {
  const request = JSON.parse(await fs.readFile(requestPath, "utf8"));
  const response = await fetch(`${aiEngineUrl}/v1/optimize`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`AI engine rejected optimization (${response.status}): ${await response.text()}`);

  const plan = await response.json();
  if (typeof plan.planId !== "string" || plan.assignments.length === 0) {
    throw new Error("AI engine returned no usable plan; refusing to create a settlement agreement.");
  }

  const orderById = new Map(request.orders.map((order) => [order.orderId, order]));
  const deadlines = plan.assignments
    .map((assignment) => orderById.get(assignment.orderId)?.deadline)
    .filter(Boolean)
    .map((value) => new Date(value));
  if (deadlines.length === 0 || deadlines.some((date) => Number.isNaN(date.valueOf()))) {
    throw new Error("Could not derive a valid SLA deadline from the orders in the AI plan.");
  }
  let slaDeadline = new Date(Math.min(...deadlines.map((date) => date.valueOf())));
  const provider = new ethers.JsonRpcProvider(chainRpcUrl);
  const network = await provider.getNetwork();
  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  let deadlineSeconds = BigInt(Math.floor(slaDeadline.valueOf() / 1000));
  if (deadlineSeconds <= nowSeconds) {
    const shiftSeconds = nowSeconds + 172_800n - deadlineSeconds;
    request.orders.forEach((order) => {
      order.deadline = new Date(new Date(order.deadline).valueOf() + Number(shiftSeconds) * 1000).toISOString();
    });
    const retryResponse = await fetch(`${aiEngineUrl}/v1/optimize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(60_000),
    });
    if (!retryResponse.ok) throw new Error(`AI engine rejected refreshed deadlines (${retryResponse.status}).`);
    const refreshedPlan = await retryResponse.json();
    plan.planId = refreshedPlan.planId;
    plan.assignments = refreshedPlan.assignments;
    slaDeadline = new Date(Math.min(...plan.assignments
      .map((assignment) => orderById.get(assignment.orderId)?.deadline)
      .filter(Boolean)
      .map((value) => new Date(value).valueOf())));
    deadlineSeconds = BigInt(Math.floor(slaDeadline.valueOf() / 1000));
  }

  const artifact = JSON.parse(await fs.readFile(artifactPath, "utf8"));
  if (artifact.contractName !== "ChainRouteSettlement") {
    throw new Error(
      `Expected ChainRouteSettlement artifact, found ${artifact.contractName}. Start the Compose stack to deploy the Track 2 contract.`,
    );
  }

  const [operator, shipper, carrier] = await provider.getSigner(0).then(async (first) => [
    first,
    await provider.getSigner(1),
    await provider.getSigner(2),
  ]);
  const settlement = new ethers.Contract(artifact.address, artifact.abi, operator);
  const shipperAddress = await shipper.getAddress();
  const carrierAddress = await carrier.getAddress();
  const termsDocument = {
    planId: plan.planId,
    shipper: shipperAddress,
    carrier: carrierAddress,
    terms: {
      freightValuePaise: "2500000",
      slaDeadline: slaDeadline.toISOString(),
      penaltyBpsPerBlock: 200,
      penaltyBlockSeconds: 21_600,
      freeHoldingHours: 6,
      demurrageRatePaisePerWagonHour: "500",
      wagonCount: plan.assignments.reduce((count, assignment) => count + assignment.wagonIds.length, 0),
    },
  };
  const termsHash = ethers.keccak256(ethers.toUtf8Bytes(canonicalJson(termsDocument)));
  const terms = {
    ...termsDocument.terms,
    slaDeadline: deadlineSeconds,
    termsHash,
  };

  const transaction = await settlement.createAgreement(plan.planId, shipperAddress, carrierAddress, terms);
  const receipt = await transaction.wait();
  const created = receipt.logs
    .map((log) => {
      try { return settlement.interface.parseLog(log); } catch { return null; }
    })
    .find((event) => event?.name === "AgreementCreated");
  const [storedAgreement] = await settlement.getContractStatus(created.args.contractId);
  if (
    storedAgreement.planId !== plan.planId ||
    storedAgreement.terms.termsHash.toLowerCase() !== termsHash.toLowerCase()
  ) {
    throw new Error("On-chain agreement readback did not match the optimizer plan and canonical terms hash.");
  }
  console.log(JSON.stringify({
    aiPlanId: plan.planId,
    aiRunId: plan.runId,
    chainId: Number(network.chainId),
    contractAddress: artifact.address,
    contractId: created.args.contractId.toString(),
    agreementHash: created.args.agreementHash,
    termsHash,
    verifiedOnChain: true,
    assignmentCount: plan.assignments.length,
    wagonCount: termsDocument.terms.wagonCount,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});