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

async function setNextTimestamp(timestamp) {
  await ethers.provider.send("evm_setNextBlockTimestamp", [Number(timestamp)]);
}

describe("ChainRouteSettlement Phase 14", function () {
  let operator;
  let shipper;
  let carrier;
  let other;

  async function createLateDisputedAgreement({ operatorIsShipper = false } = {}) {
    [operator, shipper, carrier, other] = await ethers.getSigners();
    const latestBlock = await ethers.provider.getBlock("latest");
    const terms = {
      freightValuePaise: 2500000n,
      slaDeadline: BigInt(latestBlock.timestamp + 48 * 3600),
      penaltyBpsPerBlock: 200,
      penaltyBlockSeconds: 21600,
      freeHoldingHours: 6,
      demurrageRatePaisePerWagonHour: 500n,
      wagonCount: 12,
      termsHash: ethers.keccak256(ethers.toUtf8Bytes("phase 14 terms")),
    };
    const contract = await ethers.deployContract("ChainRouteSettlement");
    await contract.waitForDeployment();
    const shipperAddress = operatorIsShipper ? operator.address : shipper.address;
    const creationReceipt = await (
      await contract.createAgreement("plan-phase-14", shipperAddress, carrier.address, terms)
    ).wait();
    const bookingReceipt = await (
      await contract.connect(carrier).confirmBooking(1)
    ).wait();
    const deliveryTimestamp = terms.slaDeadline + 13n * 3600n;
    const arrivalTimestamp = deliveryTimestamp - 10n * 3600n;

    await setNextTimestamp(arrivalTimestamp - 1n);
    const dispatchReceipt = await (
      await contract.connect(carrier).updateShipmentStatus(1, 0, arrivalTimestamp - 1n)
    ).wait();
    await setNextTimestamp(arrivalTimestamp);
    const arrivalReceipt = await (
      await contract.connect(carrier).updateShipmentStatus(1, 2, arrivalTimestamp)
    ).wait();
    await setNextTimestamp(deliveryTimestamp);
    const deliveryReceipt = await (
      await contract.connect(carrier).confirmDelivery(1, deliveryTimestamp, "pod-phase-14")
    ).wait();

    return {
      contract,
      contractId: 1n,
      terms,
      shipperAddress,
      deliveryTimestamp,
      creationReceipt,
      bookingReceipt,
      dispatchReceipt,
      arrivalReceipt,
      deliveryReceipt,
    };
  }

  async function raiseAs(fixture, signer, reason = "DELIVERY_DELAY") {
    return (
      await fixture.contract
        .connect(signer)
        .raiseDispute(fixture.contractId, reason, signer.address)
    ).wait();
  }

  it("allows a contract party to raise a dispute and appends event/history", async function () {
    const fixture = await createLateDisputedAgreement();
    const receipt = await raiseAs(fixture, shipper);
    const { agreement, history } = await fixture.contract.getContractStatus(fixture.contractId);
    const event = getEvents(fixture.contract, receipt)[0];

    assert.equal(agreement.state, 7n);
    assert.equal(event.name, "DisputeRaised");
    assert.equal(event.args.raisedBy, shipper.address);
    assert.equal(event.args.reasonCode, "DELIVERY_DELAY");
    assert.equal(history.at(-1).action, 7n);
    assert.equal(history.at(-1).actor, shipper.address);
  });

  it("blocks release while a dispute is unresolved", async function () {
    const fixture = await createLateDisputedAgreement();
    await raiseAs(fixture, shipper);
    await expectCustomError(
      fixture.contract.releasePayment(fixture.contractId),
      "InvalidState",
    );
    const { agreement } = await fixture.contract.getContractStatus(fixture.contractId);
    assert.equal(agreement.state, 7n);
  });

  it("rejects non-parties and mismatched raisedBy identities", async function () {
    const fixture = await createLateDisputedAgreement();
    await expectCustomError(
      fixture.contract.connect(other).raiseDispute(fixture.contractId, "DELAY", other.address),
      "NotContractParty",
    );
    await expectCustomError(
      fixture.contract.connect(shipper).raiseDispute(fixture.contractId, "DELAY", carrier.address),
      "NotContractParty",
    );
  });

  it("rejects resolution by anyone other than the configured arbitrator", async function () {
    const fixture = await createLateDisputedAgreement();
    await raiseAs(fixture, shipper);
    await expectCustomError(
      fixture.contract.connect(carrier).resolveDispute(fixture.contractId, 0),
      "NotArbitrator",
    );
  });

  it("applies each frozen outcome and permits release using the resolved amounts", async function () {
    const outcomes = [
      { code: 0, penalty: 150000n, demurrage: 24000n, net: 2326000n },
      { code: 1, penalty: 0n, demurrage: 24000n, net: 2476000n },
      { code: 2, penalty: 0n, demurrage: 0n, net: 2500000n },
    ];

    for (const expected of outcomes) {
      const fixture = await createLateDisputedAgreement();
      await raiseAs(fixture, shipper);
      const result = await fixture.contract.resolveDispute.staticCall(
        fixture.contractId,
        expected.code,
      );
      const receipt = await (
        await fixture.contract.resolveDispute(fixture.contractId, expected.code)
      ).wait();
      const { agreement, history } = await fixture.contract.getContractStatus(fixture.contractId);
      const event = getEvents(fixture.contract, receipt)[0];

      assert.equal(result.penaltyPaise, expected.penalty);
      assert.equal(result.demurragePaise, expected.demurrage);
      assert.equal(agreement.state, 4n);
      assert.equal(agreement.penaltyPaise, expected.penalty);
      assert.equal(agreement.demurragePaise, expected.demurrage);
      assert.equal(event.name, "DisputeResolved");
      assert.equal(event.args.outcome, BigInt(expected.code));
      assert.equal(history.at(-1).action, 8n);

      const netPayment = await fixture.contract.releasePayment.staticCall(fixture.contractId);
      await fixture.contract.releasePayment(fixture.contractId);
      assert.equal(netPayment, expected.net);
    }
  });

  it("rejects invalid outcomes and resolution outside Disputed", async function () {
    const fixture = await createLateDisputedAgreement();
    await expectCustomError(
      fixture.contract.resolveDispute(fixture.contractId, 0),
      "InvalidState",
    );
    await raiseAs(fixture, shipper);
    await expectCustomError(
      fixture.contract.resolveDispute(fixture.contractId, 3),
      "InvalidDisputeOutcome",
    );
  });

  it("rejects disputes after payment release", async function () {
    const fixture = await createLateDisputedAgreement();
    await fixture.contract.releasePayment(fixture.contractId);
    await expectCustomError(
      fixture.contract.connect(shipper).raiseDispute(
        fixture.contractId,
        "TOO_LATE",
        shipper.address,
      ),
      "InvalidState",
    );
  });

  it("keeps original penalty events and history when a dispute changes deductions", async function () {
    const fixture = await createLateDisputedAgreement();
    const before = await fixture.contract.getContractStatus(fixture.contractId);
    await raiseAs(fixture, shipper);
    const resolutionReceipt = await (
      await fixture.contract.resolveDispute(fixture.contractId, 1)
    ).wait();
    const after = await fixture.contract.getContractStatus(fixture.contractId);
    const resolutionEvent = getEvents(fixture.contract, resolutionReceipt)[0];

    assert.equal(before.agreement.penaltyPaise, 150000n);
    assert.equal(after.agreement.penaltyPaise, 0n);
    assert.equal(after.agreement.demurragePaise, 24000n);
    assert.deepEqual(after.history.map((entry) => entry.action), [0n, 1n, 2n, 2n, 3n, 4n, 5n, 7n, 8n]);
    assert.equal(after.history[5].action, 4n);
    assert.equal(resolutionEvent.name, "DisputeResolved");
    assert.equal((await fixture.contract.queryFilter(fixture.contract.filters.PenaltyCalculated())).length, 1);
  });

  it("allows another dispute after resolution before release, using current deductions", async function () {
    const fixture = await createLateDisputedAgreement();
    await raiseAs(fixture, shipper, "FIRST_REVIEW");
    await fixture.contract.resolveDispute(fixture.contractId, 1);
    await raiseAs(fixture, carrier, "SECOND_REVIEW");
    const resolutionReceipt = await (
      await fixture.contract.resolveDispute(fixture.contractId, 2)
    ).wait();
    const { agreement, history } = await fixture.contract.getContractStatus(fixture.contractId);

    assert.equal(agreement.state, 4n);
    assert.equal(agreement.penaltyPaise, 0n);
    assert.equal(agreement.demurragePaise, 0n);
    assert.deepEqual(history.slice(-4).map((entry) => entry.action), [7n, 8n, 7n, 8n]);
    assert.equal(getEvents(fixture.contract, resolutionReceipt)[0].args.outcome, 2n);
  });

  it("allows the arbitrator to also be a contract party", async function () {
    const fixture = await createLateDisputedAgreement({ operatorIsShipper: true });
    await raiseAs(fixture, carrier);
    await fixture.contract.resolveDispute(fixture.contractId, 0);
    const { agreement } = await fixture.contract.getContractStatus(fixture.contractId);

    assert.equal(fixture.shipperAddress, operator.address);
    assert.equal(agreement.state, 4n);
    assert.equal(agreement.penaltyPaise, 150000n);
  });

  it("preserves the original amounts for UpholdDeductions and appends a resolution record", async function () {
    const fixture = await createLateDisputedAgreement();
    await raiseAs(fixture, shipper);
    const receipt = await (
      await fixture.contract.resolveDispute(fixture.contractId, 0)
    ).wait();
    const { agreement, history } = await fixture.contract.getContractStatus(fixture.contractId);

    assert.equal(agreement.penaltyPaise, 150000n);
    assert.equal(agreement.demurragePaise, 24000n);
    assert.equal(history.at(-1).action, 8n);
    assert.equal(getEvents(fixture.contract, receipt)[0].args.penaltyPaise, 150000n);
  });
});