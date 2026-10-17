const assert = require("node:assert/strict");
const { ethers, artifacts } = require("hardhat");
const fs = require("node:fs");
const path = require("node:path");

const frozenAbiPath = path.join(__dirname, "../../docs/contracts/chainroute-settlement.abi.json");
const frozenAbi = JSON.parse(fs.readFileSync(frozenAbiPath, "utf8"));
const frozenErrors = new ethers.Interface(frozenAbi.filter((entry) => entry.type === "error"));

async function expectCustomError(transaction, name) {
  await assert.rejects(transaction, (error) => {
    const selector = frozenErrors.getError(name).selector.toLowerCase();
    const returnedData = [
      error.data,
      error.error?.data,
      error.info?.error?.data,
      error.message.match(/return data: (0x[0-9a-f]+)/i)?.[1],
    ].find((value) => typeof value === "string" && value.startsWith("0x"));
    assert(
      error.message.includes(name) || returnedData?.toLowerCase().startsWith(selector),
      `Expected ${name} (${selector}), got ${error.message}`,
    );
    return true;
  });
}

describe("ChainRouteSettlement", function () {
  let contract;
  let operator;
  let shipper;
  let carrier;
  let outsider;
  let deadline;

  const freight = 2_500_000n;
  const defaultTerms = (slaDeadline) => ({
    freightValuePaise: freight,
    slaDeadline,
    penaltyBpsPerBlock: 200,
    penaltyBlockSeconds: 21_600,
    freeHoldingHours: 6,
    demurrageRatePaisePerWagonHour: 500,
    wagonCount: 12,
    termsHash: ethers.id("chainroute terms"),
  });

  async function create(slaDeadline = deadline, termsOverride = {}) {
    const terms = { ...defaultTerms(slaDeadline), ...termsOverride };
    const tx = await contract.createAgreement("plan-ai-0001", shipper.address, carrier.address, terms);
    const receipt = await tx.wait();
    const event = receipt.logs
      .map((log) => {
        try { return contract.interface.parseLog(log); } catch { return null; }
      })
      .find((parsed) => parsed?.name === "AgreementCreated");
    return { contractId: event.args.contractId, terms, agreementHash: event.args.agreementHash };
  }

  async function beginTransit(contractId, arrivedAt) {
    await contract.connect(carrier).confirmBooking(contractId);
    await contract.connect(carrier).updateShipmentStatus(contractId, 0, arrivedAt - 1n);
    await contract.connect(carrier).updateShipmentStatus(contractId, 2, arrivedAt);
  }

  beforeEach(async function () {
    [operator, shipper, carrier, outsider] = await ethers.getSigners();
    const latest = await ethers.provider.getBlock("latest");
    deadline = BigInt(latest.timestamp + 1_000_000);
    contract = await ethers.deployContract("ChainRouteSettlement");
    await contract.waitForDeployment();
  });

  it("matches every function, event, and custom error in the frozen ABI", async function () {
    const artifact = await artifacts.readArtifact("ChainRouteSettlement");
    const frozen = JSON.parse(fs.readFileSync(frozenAbiPath, "utf8"));
    const actualInterface = new ethers.Interface(artifact.abi);
    const frozenInterface = new ethers.Interface(frozen);
    const categories = ["function", "event", "error"];
    for (const type of categories) {
      const actualEntries = actualInterface.fragments
        .filter((fragment) => fragment.type === type)
        .map((fragment) => fragment.format("sighash"))
        .sort();
      const frozenEntries = frozenInterface.fragments
        .filter((fragment) => fragment.type === type)
        .map((fragment) => fragment.format("sighash"))
        .sort();
      assert.deepEqual(actualEntries, frozenEntries);
    }
  });

  it("creates isolated agreements with deterministic agreement hashes and append-only history", async function () {
    const first = await create();
    const second = await create();
    assert.equal(first.contractId, 1n);
    assert.equal(second.contractId, 2n);
    assert.equal(first.agreementHash, second.agreementHash);

    const [agreement, history] = await contract.getContractStatus(first.contractId);
    assert.equal(agreement.state, 0n);
    assert.equal(agreement.planId, "plan-ai-0001");
    assert.equal(agreement.terms.freightValuePaise, freight);
    assert.deepEqual(history.map((entry) => entry.action), [0n]);
  });

  it("rejects unauthorized creation, invalid terms, and unknown ids with named errors", async function () {
    const terms = defaultTerms(deadline);
    await expectCustomError(
      contract.connect(outsider).createAgreement("plan-x", shipper.address, carrier.address, terms),
      "NotAuthorized",
    );
    await expectCustomError(
      contract.createAgreement("plan-x", shipper.address, carrier.address, { ...terms, penaltyBlockSeconds: 0 }),
      "InvalidTerms",
    );
    await expectCustomError(contract.getContractStatus(0), "UnknownContract");
  });

  it("allows only the assigned carrier to book and post monotonic shipment statuses", async function () {
    const { contractId } = await create();
    await expectCustomError(contract.connect(outsider).confirmBooking(contractId), "NotCarrier");
    await contract.connect(carrier).confirmBooking(contractId);
    await expectCustomError(contract.connect(carrier).confirmBooking(contractId), "InvalidState");

    const arrival = deadline + 10n;
    await contract.connect(carrier).updateShipmentStatus(contractId, 0, arrival - 1n);
    await expectCustomError(contract.connect(carrier).updateShipmentStatus(contractId, 9, arrival), "InvalidShipmentStatus");
    await expectCustomError(contract.connect(carrier).updateShipmentStatus(contractId, 1, arrival - 2n), "InvalidTimestamp");
    await contract.connect(carrier).updateShipmentStatus(contractId, 2, arrival);

    const [agreement, history] = await contract.getContractStatus(contractId);
    assert.equal(agreement.state, 2n);
    assert.deepEqual(history.map((entry) => entry.action), [0n, 1n, 2n, 2n]);
    assert.equal(history[3].timestamp, arrival);
  });

  it("computes deadline, started-block penalty, free-time, and rounded-up demurrage", async function () {
    const { contractId } = await create();
    assert.deepEqual(Array.from(await contract.evaluateSLA(contractId, deadline)), [true, 0n]);
    assert.deepEqual(Array.from(await contract.evaluateSLA(contractId, deadline + 1n)), [false, 1n]);
    assert.equal(await contract.calculatePenalty(contractId, 0), 0n);
    assert.equal(await contract.calculatePenalty(contractId, 1), 50_000n);
    assert.equal(await contract.calculatePenalty(contractId, 21_600), 50_000n);
    assert.equal(await contract.calculatePenalty(contractId, 21_601), 100_000n);
    assert.equal(await contract.calculateDemurrage(contractId, 100, 100 + 6 * 3600), 0n);
    assert.equal(await contract.calculateDemurrage(contractId, 100, 100 + 6 * 3600 + 1), 6_000n);
    assert.equal(await contract.calculateDemurrage(contractId, 100, 100 + 10 * 3600), 24_000n);
  });

  it("settles vector F, records event order, and prevents a second release", async function () {
    const { contractId } = await create();
    const arrival = deadline + 3n * 3600n;
    const delivery = deadline + 13n * 3600n;
    await beginTransit(contractId, arrival);
    const receipt = await (await contract.connect(carrier).confirmDelivery(contractId, delivery, "pod-vector-f")).wait();
    const emitted = receipt.logs
      .map((log) => {
        try { return contract.interface.parseLog(log)?.name; } catch { return null; }
      })
      .filter(Boolean);
    assert.deepEqual(emitted.slice(-3), ["DeliveryConfirmed", "PenaltyCalculated", "DemurrageCalculated"]);

    let [agreement, history] = await contract.getContractStatus(contractId);
    assert.equal(agreement.state, 4n);
    assert.equal(agreement.secondsLate, 13n * 3600n);
    assert.equal(agreement.penaltyPaise, 150_000n);
    assert.equal(agreement.demurragePaise, 24_000n);
    assert.deepEqual(history.map((entry) => entry.action).slice(-3), [3n, 4n, 5n]);
    const releaseReceipt = await (await contract.releasePayment(contractId)).wait();
    assert(releaseReceipt.logs.some((log) => {
      try { return contract.interface.parseLog(log)?.name === "PaymentReleased"; } catch { return false; }
    }));
    [agreement] = await contract.getContractStatus(contractId);
    assert.equal(agreement.netPaymentPaise, 2_326_000n);
    await expectCustomError(contract.releasePayment(contractId), "InvalidState");
    await contract.closeContract(contractId);
    [agreement, history] = await contract.getContractStatus(contractId);
    assert.equal(agreement.state, 6n);
    assert.equal(history.at(-1).action, 9n);
    await expectCustomError(contract.closeContract(contractId), "InvalidState");
  });

  it("settles an on-time delivery with zero deductions", async function () {
    const { contractId } = await create();
    const delivery = deadline - 3600n;
    const arrival = delivery - 4n * 3600n;
    await beginTransit(contractId, arrival);
    await contract.connect(carrier).confirmDelivery(contractId, delivery, "pod-on-time");

    const [agreement] = await contract.getContractStatus(contractId);
    assert.equal(agreement.onTime, true);
    assert.equal(agreement.penaltyPaise, 0n);
    assert.equal(agreement.demurragePaise, 0n);
    await contract.releasePayment(contractId);
    const [settled] = await contract.getContractStatus(contractId);
    assert.equal(settled.netPaymentPaise, freight);
  });

  it("caps deductions at freight value without underflow", async function () {
    const { contractId } = await create();
    const arrival = deadline + 394n * 3600n;
    const delivery = deadline + 400n * 3600n;
    await beginTransit(contractId, arrival);
    await contract.connect(carrier).confirmDelivery(contractId, delivery, "pod-capped");
    const [agreement] = await contract.getContractStatus(contractId);
    assert.equal(agreement.penaltyPaise, freight);
    assert.equal(agreement.demurragePaise, 0n);
    await contract.releasePayment(contractId);
    const [settled] = await contract.getContractStatus(contractId);
    assert.equal(settled.netPaymentPaise, 0n);
  });

  it("rejects invalid delivery and prevents delivery before the last status timestamp", async function () {
    const { contractId } = await create();
    await contract.connect(carrier).confirmBooking(contractId);
    await expectCustomError(contract.connect(carrier).confirmDelivery(contractId, deadline, "pod"), "InvalidState");
    await contract.connect(carrier).updateShipmentStatus(contractId, 2, deadline + 100n);
    await expectCustomError(contract.connect(carrier).confirmDelivery(contractId, deadline + 99n, "pod"), "InvalidTimestamp");
    await expectCustomError(contract.connect(carrier).confirmDelivery(contractId, deadline + 100n, ""), "EmptyProofOfDelivery");
  });

  it("pauses settlement for disputes and applies authorized waiver outcomes", async function () {
    const { contractId } = await create();
    const arrival = deadline + 3n * 3600n;
    await beginTransit(contractId, arrival);
    await contract.connect(carrier).confirmDelivery(contractId, deadline + 13n * 3600n, "pod-dispute");

    await expectCustomError(
      contract.connect(outsider).raiseDispute(contractId, "DELAY_CAUSE", outsider.address),
      "NotContractParty",
    );
    await contract.connect(shipper).raiseDispute(contractId, "DELAY_CAUSE", shipper.address);
    await expectCustomError(contract.releasePayment(contractId), "InvalidState");
    await expectCustomError(contract.connect(carrier).resolveDispute(contractId, 1), "NotArbitrator");
    await contract.resolveDispute(contractId, 1);

    const [agreement, history] = await contract.getContractStatus(contractId);
    assert.equal(agreement.state, 4n);
    assert.equal(agreement.penaltyPaise, 0n);
    assert.equal(agreement.demurragePaise, 24_000n);
    assert.deepEqual(history.map((entry) => entry.action).slice(-2), [7n, 8n]);
    await contract.releasePayment(contractId);
    const [settled] = await contract.getContractStatus(contractId);
    assert.equal(settled.netPaymentPaise, 2_476_000n);
  });

  it("supports uphold, waive-penalty, and waive-all dispute outcomes", async function () {
    const expected = [
      [150_000n, 24_000n, 2_326_000n],
      [0n, 24_000n, 2_476_000n],
      [0n, 0n, 2_500_000n],
    ];
    for (let outcome = 0; outcome < expected.length; outcome += 1) {
      const { contractId } = await create();
      await beginTransit(contractId, deadline + 3n * 3600n);
      await contract.connect(carrier).confirmDelivery(contractId, deadline + 13n * 3600n, `pod-outcome-${outcome}`);
      await contract.connect(shipper).raiseDispute(contractId, "REVIEW", shipper.address);
      await contract.resolveDispute(contractId, outcome);
      await contract.releasePayment(contractId);
      const [agreement] = await contract.getContractStatus(contractId);
      assert.deepEqual(
        [agreement.penaltyPaise, agreement.demurragePaise, agreement.netPaymentPaise],
        expected[outcome],
      );
    }
  });
});