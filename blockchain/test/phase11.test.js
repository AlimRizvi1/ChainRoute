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

describe("ChainRouteSettlement Phase 11", function () {
  let contract;
  let operator;
  let shipper;
  let carrier;
  let other;
  let contractId;
  let creationReceipt;

  async function createTerms() {
    const block = await ethers.provider.getBlock("latest");
    return {
      freightValuePaise: 2500000n,
      slaDeadline: BigInt(block.timestamp + 86400),
      penaltyBpsPerBlock: 200,
      penaltyBlockSeconds: 21600,
      freeHoldingHours: 6,
      demurrageRatePaisePerWagonHour: 500n,
      wagonCount: 12,
      termsHash: ethers.keccak256(ethers.toUtf8Bytes("phase 11 terms")),
    };
  }

  async function book() {
    const receipt = await (await contract.connect(carrier).confirmBooking(contractId)).wait();
    return BigInt((await ethers.provider.getBlock(receipt.blockNumber)).timestamp);
  }

  beforeEach(async function () {
    [operator, shipper, carrier, other] = await ethers.getSigners();
    contract = await ethers.deployContract("ChainRouteSettlement");
    await contract.waitForDeployment();

    const transaction = await contract.createAgreement(
      "plan-phase-11",
      shipper.address,
      carrier.address,
      await createTerms(),
    );
    creationReceipt = await transaction.wait();
    const createdEvent = getEvents(contract, creationReceipt).find(
      (event) => event.name === "AgreementCreated",
    );
    contractId = createdEvent.args.contractId;
  });

  it("moves the first valid status to InTransit and records its event and history", async function () {
    const bookingTimestamp = await book();
    const timestamp = bookingTimestamp + 10n;
    const receipt = await (
      await contract.connect(carrier).updateShipmentStatus(contractId, 0, timestamp)
    ).wait();
    const { agreement, history } = await contract.getContractStatus(contractId);
    const events = getEvents(contract, receipt);

    assert.equal(agreement.state, 2n);
    assert.equal(events.length, 1);
    assert.equal(events[0].name, "ShipmentStatusUpdated");
    assert.equal(events[0].args.status, 0n);
    assert.equal(events[0].args.actor, carrier.address);
    assert.equal(events[0].args.timestamp, timestamp);
    assert.equal(history.length, 3);
    assert.equal(history[2].action, 2n);
    assert.equal(history[2].actor, carrier.address);
    assert.equal(history[2].timestamp, timestamp);
  });

  it("records subsequent statuses without changing InTransit", async function () {
    const bookingTimestamp = await book();
    await contract.connect(carrier).updateShipmentStatus(contractId, 0, bookingTimestamp + 1n);
    const receipt = await (
      await contract.connect(carrier).updateShipmentStatus(contractId, 1, bookingTimestamp + 2n)
    ).wait();
    const { agreement, history } = await contract.getContractStatus(contractId);

    assert.equal(agreement.state, 2n);
    assert.equal(history.length, 4);
    assert.equal(history[3].action, 2n);
    assert.equal(getEvents(contract, receipt)[0].name, "ShipmentStatusUpdated");
  });

  it("rejects shipment status before booking with InvalidState", async function () {
    const block = await ethers.provider.getBlock("latest");
    await expectCustomError(
      contract.connect(carrier).updateShipmentStatus(contractId, 0, block.timestamp),
      "InvalidState",
    );
  });

  it("rejects shipment status from anyone except the assigned carrier", async function () {
    const bookingTimestamp = await book();
    await expectCustomError(
      contract.connect(other).updateShipmentStatus(contractId, 0, bookingTimestamp + 1n),
      "NotCarrier",
    );
  });

  it("rejects a timestamp earlier than booking or the previous status", async function () {
    const bookingTimestamp = await book();
    await expectCustomError(
      contract.connect(carrier).updateShipmentStatus(contractId, 0, bookingTimestamp - 1n),
      "InvalidTimestamp",
    );
    await contract.connect(carrier).updateShipmentStatus(contractId, 0, bookingTimestamp + 10n);
    await expectCustomError(
      contract.connect(carrier).updateShipmentStatus(contractId, 1, bookingTimestamp + 9n),
      "InvalidTimestamp",
    );
  });

  it("rejects status values outside the frozen enum", async function () {
    const bookingTimestamp = await book();
    await expectCustomError(
      contract.connect(carrier).updateShipmentStatus(contractId, 3, bookingTimestamp + 1n),
      "InvalidShipmentStatus",
    );
  });

  it("returns all lifecycle entries in chronological order with their actors", async function () {
    const bookingTimestamp = await book();
    await contract.connect(carrier).updateShipmentStatus(contractId, 0, bookingTimestamp + 1n);
    await contract.connect(carrier).updateShipmentStatus(contractId, 1, bookingTimestamp + 1n);
    await contract.connect(carrier).updateShipmentStatus(contractId, 2, bookingTimestamp + 4n);
    const { history } = await contract.getContractStatus(contractId);

    assert.deepEqual(history.map((entry) => entry.action), [0n, 1n, 2n, 2n, 2n]);
    assert.deepEqual(
      history.map((entry) => entry.actor),
      [operator.address, carrier.address, carrier.address, carrier.address, carrier.address],
    );
    for (let index = 1; index < history.length; index += 1) {
      assert.ok(history[index].timestamp >= history[index - 1].timestamp);
    }
  });

  it("accepts equal timestamps without treating them as regressions", async function () {
    const bookingTimestamp = await book();
    const timestamp = bookingTimestamp + 1n;
    await contract.connect(carrier).updateShipmentStatus(contractId, 0, timestamp);
    await contract.connect(carrier).updateShipmentStatus(contractId, 1, timestamp);
    const { history } = await contract.getContractStatus(contractId);

    assert.equal(history[2].timestamp, history[3].timestamp);
  });

  it("pairs every current state-changing operation with its event and history entry", async function () {
    const creationEvents = getEvents(contract, creationReceipt);
    const bookingReceipt = await (
      await contract.connect(carrier).confirmBooking(contractId)
    ).wait();
    const bookingEvents = getEvents(contract, bookingReceipt);
    const bookingTimestamp = BigInt(
      (await ethers.provider.getBlock(bookingReceipt.blockNumber)).timestamp,
    );
    const statusReceipt = await (
      await contract.connect(carrier).updateShipmentStatus(contractId, 0, bookingTimestamp)
    ).wait();
    const statusEvents = getEvents(contract, statusReceipt);
    const { history } = await contract.getContractStatus(contractId);

    assert.deepEqual(
      [creationEvents[0].name, bookingEvents[0].name, statusEvents[0].name],
      ["AgreementCreated", "BookingConfirmed", "ShipmentStatusUpdated"],
    );
    assert.deepEqual(history.map((entry) => entry.action), [0n, 1n, 2n]);
    assert.equal(history.length, creationEvents.length + bookingEvents.length + statusEvents.length);
  });
});