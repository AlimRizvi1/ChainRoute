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

describe("ChainRouteSettlement Phase 12", function () {
  let shipper;
  let carrier;

  async function createBookedAgreement(termOverrides = {}) {
    const [operator, shipperSigner, carrierSigner] = await ethers.getSigners();
    shipper = shipperSigner;
    carrier = carrierSigner;
    const latestBlock = await ethers.provider.getBlock("latest");
    const terms = {
      freightValuePaise: 2500000n,
      slaDeadline: BigInt(latestBlock.timestamp + 48 * 3600),
      penaltyBpsPerBlock: 200,
      penaltyBlockSeconds: 21600,
      freeHoldingHours: 6,
      demurrageRatePaisePerWagonHour: 500n,
      wagonCount: 12,
      termsHash: ethers.keccak256(ethers.toUtf8Bytes("phase 12 terms")),
      ...termOverrides,
    };
    let contract = await ethers.deployContract("ChainRouteSettlement");
    await contract.waitForDeployment();
    contract = settledContract(contract);
    const creation = await contract.createAgreement(
      "plan-phase-12",
      shipper.address,
      carrier.address,
      terms,
    );
    await creation.wait();
    const booking = await (await contract.connect(carrier).confirmBooking(1)).wait();
    const bookingTimestamp = BigInt(
      (await ethers.provider.getBlock(booking.blockNumber)).timestamp,
    );
    return { contract, contractId: 1n, terms, bookingTimestamp, operator };
  }

  async function postStatus(fixture, status, timestamp) {
    await setNextTimestamp(timestamp);
    await fixture.contract
      .connect(carrier)
      .updateShipmentStatus(fixture.contractId, status, timestamp);
  }

  async function arrive(fixture, arrivalTimestamp) {
    await postStatus(fixture, 0, arrivalTimestamp - 1n);
    await postStatus(fixture, 2, arrivalTimestamp);
  }

  async function deliver(fixture, deliveryTimestamp, podReference = "pod-ref-0001") {
    await setNextTimestamp(deliveryTimestamp);
    const transaction = await fixture.contract
      .connect(carrier)
      .confirmDelivery(fixture.contractId, deliveryTimestamp, podReference);
    return transaction.wait();
  }

  it("passes all eight reference penalty and demurrage vectors", async function () {
    const vectors = [
      { name: "A", deliveryOffset: -3600, heldSeconds: 4 * 3600, penalty: 0n, demurrage: 0n },
      { name: "B", deliveryOffset: 0, heldSeconds: 6 * 3600, penalty: 0n, demurrage: 0n },
      { name: "C", deliveryOffset: 1, heldSeconds: 6 * 3600, penalty: 50000n, demurrage: 0n },
      { name: "D", deliveryOffset: 6 * 3600, heldSeconds: 6 * 3600, penalty: 50000n, demurrage: 0n },
      { name: "E", deliveryOffset: 6 * 3600 + 1, heldSeconds: 6 * 3600, penalty: 100000n, demurrage: 0n },
      { name: "F", deliveryOffset: 13 * 3600, heldSeconds: 10 * 3600, penalty: 150000n, demurrage: 24000n },
      { name: "G", deliveryOffset: 0, heldSeconds: 6 * 3600 + 1800, penalty: 0n, demurrage: 6000n },
      { name: "H", deliveryOffset: 400 * 3600, heldSeconds: 6 * 3600, penalty: 2500000n, demurrage: 0n },
    ];

    for (const vector of vectors) {
      const fixture = await createBookedAgreement();
      const slaDeadline = fixture.terms.slaDeadline;
      const deliveryTimestamp = slaDeadline + BigInt(vector.deliveryOffset);
      const arrivalTimestamp = deliveryTimestamp - BigInt(vector.heldSeconds);
      await arrive(fixture, arrivalTimestamp);

      const sla = await fixture.contract.evaluateSLA(fixture.contractId, deliveryTimestamp);
      const secondsLate = vector.deliveryOffset > 0 ? BigInt(vector.deliveryOffset) : 0n;
      assert.equal(sla.onTime, vector.deliveryOffset <= 0, `vector ${vector.name} SLA`);
      assert.equal(sla.secondsLate, secondsLate, `vector ${vector.name} late seconds`);
      assert.equal(
        await fixture.contract.calculatePenalty(fixture.contractId, secondsLate),
        vector.penalty,
        `vector ${vector.name} penalty calculator`,
      );
      assert.equal(
        await fixture.contract.calculateDemurrage(
          fixture.contractId,
          arrivalTimestamp,
          deliveryTimestamp,
        ),
        vector.demurrage,
        `vector ${vector.name} demurrage calculator`,
      );

      const receipt = await deliver(fixture, deliveryTimestamp);
      const { agreement, history } = await fixture.contract.getContractStatus(fixture.contractId);
      const events = getEvents(fixture.contract, receipt);

      assert.equal(agreement.state, 4n, `vector ${vector.name} final state`);
      assert.equal(agreement.onTime, vector.deliveryOffset <= 0, `vector ${vector.name} onTime`);
      assert.equal(agreement.secondsLate, secondsLate, `vector ${vector.name} secondsLate`);
      assert.equal(agreement.penaltyPaise, vector.penalty, `vector ${vector.name} stored penalty`);
      assert.equal(
        agreement.demurragePaise,
        vector.demurrage,
        `vector ${vector.name} stored demurrage`,
      );
      assert.equal(agreement.deliveryTimestamp, deliveryTimestamp);
      assert.equal(agreement.podReference, "pod-ref-0001");
      assert.deepEqual(
        events.map((event) => event.name),
        ["DeliveryConfirmed", "PenaltyCalculated", "DemurrageCalculated"],
        `vector ${vector.name} event order`,
      );
      assert.deepEqual(
        history.slice(-3).map((entry) => entry.action),
        [3n, 4n, 5n],
        `vector ${vector.name} history order`,
      );
    }
  });

  it("rejects an empty proof-of-delivery reference", async function () {
    const fixture = await createBookedAgreement();
    const arrivalTimestamp = fixture.terms.slaDeadline - 3600n;
    await arrive(fixture, arrivalTimestamp);
    const deliveryTimestamp = arrivalTimestamp + 1n;
    await setNextTimestamp(deliveryTimestamp);

    await expectCustomError(
      fixture.contract
        .connect(carrier)
        .confirmDelivery(fixture.contractId, deliveryTimestamp, ""),
      "EmptyProofOfDelivery",
    );
  });

  it("rejects delivery before transit and repeated delivery", async function () {
    const fixture = await createBookedAgreement();
    await expectCustomError(
      fixture.contract.connect(carrier).confirmDelivery(
        fixture.contractId,
        fixture.terms.slaDeadline,
        "pod-ref-0001",
      ),
      "InvalidState",
    );

    const arrivalTimestamp = fixture.terms.slaDeadline - 3600n;
    await arrive(fixture, arrivalTimestamp);
    const receipt = await deliver(fixture, fixture.terms.slaDeadline);
    const deliveryEvent = getEvents(fixture.contract, receipt)[0];
    assert.equal(deliveryEvent.name, "DeliveryConfirmed");
    await expectCustomError(
      fixture.contract.connect(carrier).confirmDelivery(
        fixture.contractId,
        fixture.terms.slaDeadline,
        "pod-ref-0001",
      ),
      "InvalidState",
    );
  });

  it("rejects delivery timestamps earlier than arrival or later than the current chain time", async function () {
    const fixture = await createBookedAgreement();
    const arrivalTimestamp = fixture.terms.slaDeadline - 3600n;
    await arrive(fixture, arrivalTimestamp);
    await expectCustomError(
      fixture.contract.connect(carrier).confirmDelivery(
        fixture.contractId,
        arrivalTimestamp - 1n,
        "pod-ref-0001",
      ),
      "InvalidTimestamp",
    );
    await expectCustomError(
      fixture.contract.connect(carrier).confirmDelivery(
        fixture.contractId,
        fixture.terms.slaDeadline,
        "pod-ref-0001",
      ),
      "InvalidTimestamp",
    );
  });

  it("does not charge demurrage without an arrival milestone", async function () {
    const fixture = await createBookedAgreement();
    const dispatchTimestamp = fixture.terms.slaDeadline - 3600n;
    await postStatus(fixture, 0, dispatchTimestamp);
    const receipt = await deliver(fixture, fixture.terms.slaDeadline);
    const { agreement } = await fixture.contract.getContractStatus(fixture.contractId);

    assert.equal(agreement.penaltyPaise, 0n);
    assert.equal(agreement.demurragePaise, 0n);
    assert.equal(getEvents(fixture.contract, receipt)[2].args.heldSeconds, 0n);
  });

  it("caps combined deductions at freight value, applying penalty before demurrage", async function () {
    const fixture = await createBookedAgreement({
      freightValuePaise: 100n,
      penaltyBpsPerBlock: 2000,
      freeHoldingHours: 0,
      demurrageRatePaisePerWagonHour: 100n,
      wagonCount: 1,
    });
    const deliveryTimestamp = fixture.terms.slaDeadline + 1n;
    const arrivalTimestamp = deliveryTimestamp - 3600n;
    await arrive(fixture, arrivalTimestamp);
    await deliver(fixture, deliveryTimestamp);
    const { agreement } = await fixture.contract.getContractStatus(fixture.contractId);

    assert.equal(agreement.penaltyPaise, 20n);
    assert.equal(agreement.demurragePaise, 80n);
    assert.equal(agreement.penaltyPaise + agreement.demurragePaise, 100n);
  });

  it("still applies penalty when the demurrage rate is zero", async function () {
    const fixture = await createBookedAgreement({ demurrageRatePaisePerWagonHour: 0n });
    const deliveryTimestamp = fixture.terms.slaDeadline + 21600n;
    const arrivalTimestamp = deliveryTimestamp - 6n * 3600n;
    await arrive(fixture, arrivalTimestamp);
    await deliver(fixture, deliveryTimestamp);
    const { agreement } = await fixture.contract.getContractStatus(fixture.contractId);

    assert.equal(agreement.penaltyPaise, 50000n);
    assert.equal(agreement.demurragePaise, 0n);
  });
});