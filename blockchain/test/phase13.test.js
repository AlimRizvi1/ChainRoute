const assert = require("node:assert/strict");

const { settledContract, expectCustomError } = require("./settled-contract");

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

describe("ChainRouteSettlement Phase 13", function () {
  let operator;
  let shipper;
  let carrier;
  let other;

  async function prepareSettlement({ deliveryOffset, heldSeconds, termOverrides = {} }) {
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
      termsHash: ethers.keccak256(ethers.toUtf8Bytes("phase 13 terms")),
      ...termOverrides,
    };
    let contract = await ethers.deployContract("ChainRouteSettlement");
    await contract.waitForDeployment();
    contract = settledContract(contract);
    const creationReceipt = await (
      await contract.createAgreement("plan-phase-13", shipper.address, carrier.address, terms)
    ).wait();
    const bookingReceipt = await (
      await contract.connect(carrier).confirmBooking(1)
    ).wait();
    const deliveryTimestamp = terms.slaDeadline + BigInt(deliveryOffset);
    const arrivalTimestamp = deliveryTimestamp - BigInt(heldSeconds);

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
      await contract.connect(carrier).confirmDelivery(1, deliveryTimestamp, "pod-phase-13")
    ).wait();

    return {
      contract,
      contractId: 1n,
      terms,
      deliveryTimestamp,
      creationReceipt,
      bookingReceipt,
      dispatchReceipt,
      arrivalReceipt,
      deliveryReceipt,
    };
  }

  it("releases vector F accounting net payment of 2,326,000 and records its event", async function () {
    const fixture = await prepareSettlement({ deliveryOffset: 13 * 3600, heldSeconds: 10 * 3600 });
    const expected = await fixture.contract.releasePayment.staticCall(fixture.contractId);
    const receipt = await (
      await fixture.contract.releasePayment(fixture.contractId)
    ).wait();
    const { agreement, history } = await fixture.contract.getContractStatus(fixture.contractId);
    const event = getEvents(fixture.contract, receipt)[0];

    assert.equal(expected, 2326000n);
    assert.equal(agreement.state, 5n);
    assert.equal(agreement.netPaymentPaise, 2326000n);
    assert.equal(event.name, "PaymentReleased");
    assert.equal(event.args.grossPaise, 2500000n);
    assert.equal(event.args.penaltyPaise, 150000n);
    assert.equal(event.args.demurragePaise, 24000n);
    assert.equal(event.args.netPaymentPaise, 2326000n);
    assert.equal(history.at(-1).action, 6n);
    assert.equal(history.at(-1).actor, operator.address);
  });

  it("releases vector A at full freight value", async function () {
    const fixture = await prepareSettlement({ deliveryOffset: -3600, heldSeconds: 4 * 3600 });
    const netPayment = await fixture.contract.releasePayment.staticCall(fixture.contractId);
    await fixture.contract.releasePayment(fixture.contractId);
    const { agreement } = await fixture.contract.getContractStatus(fixture.contractId);

    assert.equal(netPayment, 2500000n);
    assert.equal(agreement.netPaymentPaise, 2500000n);
  });

  it("releases vector H as a valid zero-net accounting payment", async function () {
    const fixture = await prepareSettlement({ deliveryOffset: 400 * 3600, heldSeconds: 6 * 3600 });
    const netPayment = await fixture.contract.releasePayment.staticCall(fixture.contractId);
    await fixture.contract.releasePayment(fixture.contractId);
    const { agreement } = await fixture.contract.getContractStatus(fixture.contractId);

    assert.equal(netPayment, 0n);
    assert.equal(agreement.netPaymentPaise, 0n);
    assert.equal(agreement.state, 5n);
  });

  it("rejects release before PenaltyCalculated", async function () {
    [operator, shipper, carrier] = await ethers.getSigners();
    const latestBlock = await ethers.provider.getBlock("latest");
    let contract = await ethers.deployContract("ChainRouteSettlement");
    await contract.waitForDeployment();
    contract = settledContract(contract);
    await contract.createAgreement("plan-early-release", shipper.address, carrier.address, {
      freightValuePaise: 100n,
      slaDeadline: BigInt(latestBlock.timestamp + 86400),
      penaltyBpsPerBlock: 200,
      penaltyBlockSeconds: 21600,
      freeHoldingHours: 6,
      demurrageRatePaisePerWagonHour: 500n,
      wagonCount: 1,
      termsHash: ethers.keccak256(ethers.toUtf8Bytes("early release")),
    });

    await expectCustomError(contract.releasePayment(1), "InvalidState");
  });

  it("rejects release by a non-operator", async function () {
    const fixture = await prepareSettlement({ deliveryOffset: 0, heldSeconds: 6 * 3600 });
    await expectCustomError(
      fixture.contract.connect(carrier).releasePayment(fixture.contractId),
      "NotAuthorized",
    );
  });

  it("rejects a repeated release without recording a second payout", async function () {
    const fixture = await prepareSettlement({ deliveryOffset: 0, heldSeconds: 6 * 3600 });
    await fixture.contract.releasePayment(fixture.contractId);
    await expectCustomError(
      fixture.contract.releasePayment(fixture.contractId),
      "InvalidState",
    );
    const { history } = await fixture.contract.getContractStatus(fixture.contractId);
    assert.equal(history.filter((entry) => entry.action === 6n).length, 1);
  });

  it("closes only a released contract and records the close event", async function () {
    const fixture = await prepareSettlement({ deliveryOffset: 0, heldSeconds: 6 * 3600 });
    await fixture.contract.releasePayment(fixture.contractId);
    const receipt = await (await fixture.contract.closeContract(fixture.contractId)).wait();
    const { agreement, history } = await fixture.contract.getContractStatus(fixture.contractId);
    const event = getEvents(fixture.contract, receipt)[0];

    assert.equal(agreement.state, 6n);
    assert.equal(event.name, "ContractClosed");
    assert.equal(event.args.contractId, fixture.contractId);
    assert.equal(history.at(-1).action, 9n);
    assert.equal(history.at(-1).actor, operator.address);
  });

  it("rejects close before release and close by a non-operator", async function () {
    const fixture = await prepareSettlement({ deliveryOffset: 0, heldSeconds: 6 * 3600 });
    await expectCustomError(
      fixture.contract.closeContract(fixture.contractId),
      "InvalidState",
    );
    await fixture.contract.releasePayment(fixture.contractId);
    await expectCustomError(
      fixture.contract.connect(other).closeContract(fixture.contractId),
      "NotAuthorized",
    );
  });

  it("makes every existing state-changing action fail after closure", async function () {
    const fixture = await prepareSettlement({ deliveryOffset: 0, heldSeconds: 6 * 3600 });
    await fixture.contract.releasePayment(fixture.contractId);
    await fixture.contract.closeContract(fixture.contractId);

    await expectCustomError(
      fixture.contract.connect(carrier).confirmBooking(fixture.contractId),
      "InvalidState",
    );
    await expectCustomError(
      fixture.contract.connect(carrier).updateShipmentStatus(fixture.contractId, 0, 1),
      "InvalidState",
    );
    await expectCustomError(
      fixture.contract.connect(carrier).confirmDelivery(fixture.contractId, 1, "pod"),
      "InvalidState",
    );
    await expectCustomError(fixture.contract.releasePayment(fixture.contractId), "InvalidState");
    await expectCustomError(fixture.contract.closeContract(fixture.contractId), "InvalidState");
  });

  it("completes the full late-delivery flow with immutable ordered history", async function () {
    const fixture = await prepareSettlement({ deliveryOffset: 13 * 3600, heldSeconds: 10 * 3600 });
    const releaseReceipt = await (
      await fixture.contract.releasePayment(fixture.contractId)
    ).wait();
    const closeReceipt = await (
      await fixture.contract.closeContract(fixture.contractId)
    ).wait();
    const { agreement, history } = await fixture.contract.getContractStatus(fixture.contractId);
    const eventNames = [
      ...getEvents(fixture.contract, fixture.creationReceipt),
      ...getEvents(fixture.contract, fixture.bookingReceipt),
      ...getEvents(fixture.contract, fixture.dispatchReceipt),
      ...getEvents(fixture.contract, fixture.arrivalReceipt),
      ...getEvents(fixture.contract, fixture.deliveryReceipt),
      ...getEvents(fixture.contract, releaseReceipt),
      ...getEvents(fixture.contract, closeReceipt),
    ].map((event) => event.name);

    assert.deepEqual(eventNames, [
      "AgreementCreated",
      "BookingConfirmed",
      "ShipmentStatusUpdated",
      "ShipmentStatusUpdated",
      "DeliveryConfirmed",
      "PenaltyCalculated",
      "DemurrageCalculated",
      "PaymentReleased",
      "ContractClosed",
    ]);
    assert.deepEqual(history.map((entry) => entry.action), [0n, 1n, 2n, 2n, 3n, 4n, 5n, 6n, 9n]);
    assert.equal(agreement.state, 6n);
    assert.equal(agreement.netPaymentPaise, 2326000n);
  });
});