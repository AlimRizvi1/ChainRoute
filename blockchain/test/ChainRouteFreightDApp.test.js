const assert = require("node:assert/strict");
const { ethers } = require("hardhat");

describe("ChainRoute wallet freight receipts", function () {
  async function setup() {
    const [operator, shipper, carrier, outsider] = await ethers.getSigners();
    const contract = await ethers.deployContract("ChainRouteFreightDApp");
    await contract.waitForDeployment();
    const block = await ethers.provider.getBlock("latest");
    const terms = { freightValuePaise: 2500000n, slaDeadline: block.timestamp + 86400, penaltyBpsPerBlock: 100,
      penaltyBlockSeconds: 3600, freeHoldingHours: 4, demurrageRatePaisePerWagonHour: 5000n, wagonCount: 2,
      termsHash: ethers.keccak256(ethers.toUtf8Bytes("saved allocation and terms")) };
    return { operator, shipper, carrier, outsider, contract, terms };
  }
  it("deploys below EIP-170's size limit and implements ERC-721 metadata", async function () {
    const { contract } = await setup();
    assert.ok((await ethers.provider.getCode(await contract.getAddress())).length / 2 - 1 <= 24576);
    assert.equal(await contract.supportsInterface("0x80ac58cd"), true);
    assert.equal(await contract.supportsInterface("0x5b5e139f"), true);
    assert.equal(await contract.symbol(), "CRFR");
  });
  it("atomically creates freight and mints one receipt; only the shipper pays gas", async function () {
    const { shipper, carrier, contract, terms } = await setup();
    const before = await ethers.provider.getBalance(shipper.address);
    const carrierBefore = await ethers.provider.getBalance(carrier.address);
    const receipt = await (await contract.connect(shipper).initiateFreight("wallet-plan-1", carrier.address, terms)).wait();
    assert.equal(await contract.ownerOf(1), shipper.address);
    assert.equal(await contract.totalFreightReceipts(), 1n);
    assert.equal(before - await ethers.provider.getBalance(shipper.address), receipt.gasUsed * receipt.gasPrice);
    assert.equal(await ethers.provider.getBalance(carrier.address), carrierBefore);
    assert.equal(await ethers.provider.getBalance(await contract.getAddress()), 0n);
    const [agreement, history] = await contract.getContractStatus(1);
    assert.equal(agreement.shipper, shipper.address); assert.equal(agreement.planId, "wallet-plan-1");
    assert.equal(history[0].actor, shipper.address);
    const metadata = JSON.parse(Buffer.from((await contract.tokenURI(1)).split(",")[1], "base64").toString());
    assert.equal(metadata.name, "ChainRoute Freight Receipt #1");
    assert.ok(metadata.attributes.some(a => a.value === terms.termsHash));
  });
  it("rejects duplicate plans, expired terms, nonzero ETH, and unauthorized booking", async function () {
    const { shipper, carrier, outsider, contract, terms } = await setup();
    await contract.connect(shipper).initiateFreight("unique", carrier.address, terms);
    await assert.rejects(contract.connect(shipper).initiateFreight("unique", carrier.address, terms));
    await assert.rejects(contract.connect(shipper).initiateFreight("expired", carrier.address, { ...terms, slaDeadline: 1 }));
    await assert.rejects(contract.connect(shipper).initiateFreight("paid", carrier.address, terms, { value: 1n }));
    await assert.rejects(contract.connect(outsider).confirmBooking(1));
    await contract.connect(carrier).confirmBooking(1);
    assert.equal((await contract.getContractStatus(1))[0].state, 1n);
    assert.equal(await contract.totalFreightReceipts(), 1n);
  });
  it("receipt transfers do not grant the new holder carrier or operator powers", async function () {
    const { shipper, carrier, outsider, contract, terms } = await setup();
    await contract.connect(shipper).initiateFreight("transfer", carrier.address, terms);
    await contract.connect(shipper).transferFrom(shipper.address, outsider.address, 1);
    assert.equal(await contract.ownerOf(1), outsider.address);
    assert.equal((await contract.getContractStatus(1))[0].shipper, shipper.address);
    await assert.rejects(contract.connect(outsider).confirmBooking(1));
    await assert.rejects(contract.connect(outsider).releasePayment(1));
  });
});
