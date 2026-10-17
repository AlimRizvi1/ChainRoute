const assert = require("node:assert/strict");

describe("ChainRoute Phase 9 workspace", function () {
  it("deploys and allows a second account to set the stored value", async function () {
    const [deployer, secondAccount] = await ethers.getSigners();
    const contract = await ethers.deployContract("ChainRoutePlaceholder");
    await contract.waitForDeployment();

    assert.notEqual(deployer.address, secondAccount.address);
    assert.equal(await contract.value(), 0n);

    await contract.connect(secondAccount).setValue(42n);

    assert.equal(await contract.value(), 42n);
  });

  it("supports advancing local chain time by one hour", async function () {
    const before = await ethers.provider.getBlock("latest");

    await ethers.provider.send("evm_increaseTime", [3600]);
    await ethers.provider.send("evm_mine", []);

    const after = await ethers.provider.getBlock("latest");
    assert.ok(after.timestamp - before.timestamp >= 3600);
  });
});