const { expect } = require("chai");
const { ethers } = require("hardhat");

const D = 8n;
const usd = (x) => ethers.parseUnits(String(x), Number(D));
const SRC = "https://example.org/source";

async function deploy() {
  const [owner, other] = await ethers.getSigners();
  const Feed = await ethers.getContractFactory("API16PriceFeed");
  const merey = await Feed.deploy(D, "MEREY16 / USD (monthly avg)");
  const brent = await Feed.deploy(D, "BRENT / USD (monthly avg)");
  return { owner, other, merey, brent };
}

describe("API16PriceFeed", () => {
  it("starts empty and reverts reads", async () => {
    const { merey } = await deploy();
    expect(await merey.latestRound()).to.equal(0n);
    await expect(merey.latestRoundData()).to.be.revertedWithCustomError(merey, "NoDataPresent");
  });

  it("publishes a month and answers like a Chainlink feed", async () => {
    const { merey } = await deploy();
    await expect(merey.publish(202609, usd("93.75"), 0, SRC))
      .to.emit(merey, "AnswerPublished").withArgs(1n, 202609, usd("93.75"), 0, SRC);
    const [roundId, answer, startedAt, updatedAt, answeredInRound] = await merey.latestRoundData();
    expect(roundId).to.equal(1n);
    expect(answer).to.equal(usd("93.75"));
    expect(updatedAt).to.equal(startedAt);
    expect(answeredInRound).to.equal(1n);
    expect(await merey.decimals()).to.equal(8);
    expect(await merey.description()).to.equal("MEREY16 / USD (monthly avg)");
    const detail = await merey.getRoundDetail(1);
    expect(detail.period).to.equal(202609);
    expect(detail.source).to.equal(SRC);
    expect(await merey.roundOfPeriod(202609)).to.equal(1n);
  });

  it("only the owner can publish", async () => {
    const { merey, other } = await deploy();
    await expect(merey.connect(other).publish(202609, usd(90), 0, SRC))
      .to.be.revertedWithCustomError(merey, "NotOwner");
  });

  it("rejects repeated or older months, bad months and non-positive prices", async () => {
    const { merey } = await deploy();
    await merey.publish(202608, usd("76.82"), 0, SRC);
    await expect(merey.publish(202608, usd(1), 0, SRC)).to.be.revertedWithCustomError(merey, "PeriodNotIncreasing");
    await expect(merey.publish(202607, usd(1), 0, SRC)).to.be.revertedWithCustomError(merey, "PeriodNotIncreasing");
    await expect(merey.publish(202613, usd(1), 0, SRC)).to.be.revertedWithCustomError(merey, "InvalidPeriod");
    await expect(merey.publish(202609, 0, 0, SRC)).to.be.revertedWithCustomError(merey, "InvalidAnswer");
  });

  it("records corrections publicly", async () => {
    const { merey } = await deploy();
    await merey.publish(202607, usd("66.89"), 1, SRC);
    await expect(merey.correct(1, usd("66.90"), 0, SRC, "OPEC report published"))
      .to.emit(merey, "AnswerCorrected").withArgs(1n, 202607, usd("66.89"), usd("66.90"), "OPEC report published");
    const d = await merey.getRoundDetail(1);
    expect(d.answer).to.equal(usd("66.90"));
    expect(d.dataType).to.equal(0);
  });

  it("transfers ownership in two steps", async () => {
    const { merey, other } = await deploy();
    await merey.transferOwnership(other.address);
    expect(await merey.owner()).to.not.equal(other.address);
    await merey.connect(other).acceptOwnership();
    expect(await merey.owner()).to.equal(other.address);
  });
});

describe("API16SpreadReader", () => {
  it("returns Brent minus Merey for the same month", async () => {
    const { merey, brent } = await deploy();
    await merey.publish(202609, usd("93.75"), 0, SRC);
    await brent.publish(202609, usd("114.16"), 0, SRC);
    const Reader = await ethers.getContractFactory("API16SpreadReader");
    const r = await Reader.deploy(await brent.getAddress(), await merey.getAddress());
    expect(await r.spreadOf(202609)).to.equal(usd("20.41"));
    await expect(r.spreadOf(202608)).to.be.revertedWithCustomError(r, "MissingPeriod");
  });
});
