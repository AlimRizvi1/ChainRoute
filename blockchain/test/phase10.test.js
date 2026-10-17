const assert = require("node:assert/strict");

async function expectCustomError(action, errorName) {
  await assert.rejects(action, (error) => error.message.includes(errorName));
}

function getEvents(contract, receipt) {
  return receipt.logs
    .map((log) => {
      try {
        return contract.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

describe("ChainRouteSettlement Phase 10", function () {
  let contract;
  let operator;
  let shipper;
  let carrier;
  let other;

  async function validTerms(overrides = {}) {
    const latestBlock = await ethers.provider.getBlock("latest");
    return {
      freightValuePaise: 2500000n,
      slaDeadline: BigInt(latestBlock.timestamp + 86400),
      penaltyBpsPerBlock: 200,
      penaltyBlockSeconds: 21600,
      freeHoldingHours: 6,
      demurrageRatePaisePerWagonHour: 500n,
      wagonCount: 12,
      termsHash: ethers.keccak256(ethers.toUtf8Bytes("canonical terms")),
      ...overrides,
    };
  }

  async function createAgreement(overrides = {}) {
    const terms = await validTerms(overrides.terms);
    const planId = overrides.planId ?? "plan-demo-0001";
    const shipperAddress = overrides.shipper ?? shipper.address;
    const carrierAddress = overrides.carrier ?? carrier.address;
    const result = await contract.createAgreement.staticCall(
      planId,
      shipperAddress,
      carrierAddress,
      terms,
    );
    const transaction = await contract.createAgreement(
      planId,
      shipperAddress,
      carrierAddress,
      terms,
    );
    const receipt = await transaction.wait();
    return { contractId: result.contractId, agreementHash: result.agreementHash, receipt, terms };
  }

  beforeEach(async function () {
    [operator, shipper, carrier, other] = await ethers.getSigners();
    contract = await ethers.deployContract("ChainRouteSettlement");
    await contract.waitForDeployment();
  });

  it("creates agreement 1 with exact terms, Created state, event, and initial history", async function () {
    const created = await createAgreement();
    const { agreement, history } = await contract.getContractStatus(created.contractId);
    const events = getEvents(contract, created.receipt);

    assert.equal(created.contractId, 1n);
    assert.equal(agreement.state, 0n);
    assert.equal(agreement.planId, "plan-demo-0001");
    assert.equal(agreement.shipper, shipper.address);
    assert.equal(agreement.carrier, carrier.address);
    assert.deepEqual(
      Array.from(agreement.terms),
      Object.values(created.terms).map((value) =>
        typeof value === "number" ? BigInt(value) : value,
      ),
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].name, "AgreementCreated");
    assert.equal(events[0].args.agreementHash, created.agreementHash);
    assert.equal(history.length, 1);
    assert.equal(history[0].action, 0n);
    assert.equal(history[0].actor, operator.address);
    assert.equal(history[0].dataHash, created.agreementHash);
  });

  it("allocates incrementing IDs without changing earlier agreements", async function () {
    const first = await createAgreement();
    const second = await createAgreement({ planId: "plan-demo-0002" });
    const firstStatus = await contract.getContractStatus(first.contractId);
    const secondStatus = await contract.getContractStatus(second.contractId);

    assert.equal(first.contractId, 1n);
    assert.equal(second.contractId, 2n);
    assert.equal(firstStatus.agreement.planId, "plan-demo-0001");
    assert.equal(secondStatus.agreement.planId, "plan-demo-0002");
  });

  it("produces deterministic agreement hashes and changes them with any bound input", async function () {
    const first = await createAgreement();
    const duplicateTerms = { ...first.terms };
    const sameAgreement = await contract.createAgreement.staticCall(
      "plan-demo-0001",
      shipper.address,
      carrier.address,
      duplicateTerms,
    );
    const changedTerms = await contract.createAgreement.staticCall(
      "plan-demo-0001",
      shipper.address,
      carrier.address,
      { ...duplicateTerms, freightValuePaise: 2500001n },
    );

    assert.equal(sameAgreement.agreementHash, first.agreementHash);
    assert.notEqual(changedTerms.agreementHash, first.agreementHash);
  });

  it("rejects agreement creation by a non-operator", async function () {
    await expectCustomError(
      contract.connect(other).createAgreement(
        "plan-demo-0001",
        shipper.address,
        carrier.address,
        await validTerms(),
      ),
      "NotAuthorized",
    );
  });

  it("rejects malformed terms with the InvalidTerms error", async function () {
    const terms = await validTerms();
    const invalidCases = [
      ["", shipper.address, carrier.address, terms],
      ["plan-demo-0001", ethers.ZeroAddress, carrier.address, terms],
      ["plan-demo-0001", shipper.address, carrier.address, { ...terms, freightValuePaise: 0n }],
      ["plan-demo-0001", shipper.address, carrier.address, { ...terms, slaDeadline: 1n }],
      ["plan-demo-0001", shipper.address, carrier.address, { ...terms, penaltyBlockSeconds: 0 }],
      ["plan-demo-0001", shipper.address, carrier.address, { ...terms, wagonCount: 0 }],
      ["plan-demo-0001", shipper.address, carrier.address, { ...terms, termsHash: ethers.ZeroHash }],
    ];

    for (const [planId, shipperAddress, carrierAddress, candidateTerms] of invalidCases) {
      await expectCustomError(
        contract.createAgreement(planId, shipperAddress, carrierAddress, candidateTerms),
        "InvalidTerms",
      );
    }
  });

  it("allows the assigned carrier to book and appends the matching event and history", async function () {
    const created = await createAgreement();
    const transaction = await contract.connect(carrier).confirmBooking(created.contractId);
    const receipt = await transaction.wait();
    const { agreement, history } = await contract.getContractStatus(created.contractId);
    const events = getEvents(contract, receipt);

    assert.equal(agreement.state, 1n);
    assert.equal(events.length, 1);
    assert.equal(events[0].name, "BookingConfirmed");
    assert.equal(events[0].args.carrier, carrier.address);
    assert.equal(history.length, 2);
    assert.deepEqual(history.map((entry) => entry.action), [0n, 1n]);
    assert.deepEqual(history.map((entry) => entry.actor), [operator.address, carrier.address]);
    assert.ok(history[1].timestamp >= history[0].timestamp);
  });

  it("rejects booking by a non-carrier", async function () {
    const created = await createAgreement();
    await expectCustomError(
      contract.connect(other).confirmBooking(created.contractId),
      "NotCarrier",
    );
  });

  it("rejects double booking with InvalidState", async function () {
    const created = await createAgreement();
    await contract.connect(carrier).confirmBooking(created.contractId);
    await expectCustomError(
      contract.connect(carrier).confirmBooking(created.contractId),
      "InvalidState",
    );
  });

  it("rejects unknown and zero IDs from booking and reads", async function () {
    await expectCustomError(contract.getContractStatus(0), "UnknownContract");
    await expectCustomError(contract.getContractStatus(1), "UnknownContract");
    await expectCustomError(contract.connect(carrier).confirmBooking(1), "UnknownContract");
  });

  it("keeps agreement histories isolated", async function () {
    const first = await createAgreement();
    const second = await createAgreement({ planId: "plan-demo-0002" });
    await contract.connect(carrier).confirmBooking(first.contractId);
    const firstStatus = await contract.getContractStatus(first.contractId);
    const secondStatus = await contract.getContractStatus(second.contractId);

    assert.equal(firstStatus.agreement.state, 1n);
    assert.equal(firstStatus.history.length, 2);
    assert.equal(secondStatus.agreement.state, 0n);
    assert.equal(secondStatus.history.length, 1);
  });

  it("permits the same address to be shipper and carrier", async function () {
    const created = await createAgreement({ shipper: carrier.address, carrier: carrier.address });
    const { agreement } = await contract.getContractStatus(created.contractId);

    assert.equal(agreement.shipper, carrier.address);
    assert.equal(agreement.carrier, carrier.address);
    await contract.connect(carrier).confirmBooking(created.contractId);
  });

  it("supports one-hour local chain time travel", async function () {
    const before = await ethers.provider.getBlock("latest");
    await ethers.provider.send("evm_increaseTime", [3600]);
    await ethers.provider.send("evm_mine", []);
    const after = await ethers.provider.getBlock("latest");

    assert.ok(after.timestamp - before.timestamp >= 3600);
  });
});