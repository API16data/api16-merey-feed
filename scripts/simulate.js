// Deploys the API16 feeds on Hardhat's built-in local network, publishes every month
// from data/merey_brent_monthly.json, then reads it all back from the contracts.
// No wallet, no real network, no cost. Output: data/onchain_readback.json
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

const EIA = "https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?n=PET&s=RBRTE&f=M";
const D = 8;

async function main() {
  const rows = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "merey_brent_monthly.json"), "utf8"));
  const [publisher] = await ethers.getSigners();
  const Feed = await ethers.getContractFactory("API16PriceFeed");
  const merey = await Feed.deploy(D, "MEREY16 / USD (monthly avg)");
  const brent = await Feed.deploy(D, "BRENT / USD (monthly avg)");
  let gas = { deploy: 0n, publish: 0n };
  for (const c of [merey, brent]) gas.deploy += (await c.deploymentTransaction().wait()).gasUsed;

  for (const r of rows) {
    const period = Number(r.month.replace("-", ""));
    const kind = r.merey_dato === "derivado" ? 1 : 0;
    const t1 = await merey.publish(period, ethers.parseUnits(r.merey.toFixed(2), D), kind, r.merey_fuente);
    const t2 = await brent.publish(period, ethers.parseUnits(r.brent.toFixed(2), D), 0, EIA);
    gas.publish += (await t1.wait()).gasUsed + (await t2.wait()).gasUsed;
  }
  const Reader = await ethers.getContractFactory("API16SpreadReader");
  const reader = await Reader.deploy(await brent.getAddress(), await merey.getAddress());
  gas.deploy += (await reader.deploymentTransaction().wait()).gasUsed;

  // ---- read everything back from the chain ----
  const out = [];
  const last = Number(await merey.latestRound());
  for (let i = 1; i <= last; i++) {
    const m = await merey.getRoundDetail(i);
    const b = await brent.getRoundDetail(await brent.roundOfPeriod(m.period));
    const spread = await reader.spreadOf(m.period);
    const p = String(m.period);
    out.push({
      month: `${p.slice(0, 4)}-${p.slice(4)}`,
      round: i,
      merey_onchain: Number(ethers.formatUnits(m.answer, D)),
      brent_onchain: Number(ethers.formatUnits(b.answer, D)),
      spread_onchain: Number(ethers.formatUnits(spread, D)),
      merey_type: Number(m.dataType) === 1 ? "derived" : "reported",
      merey_source: m.source,
    });
  }
  const [, latest] = await merey.latestRoundData();

  // check the readback matches the input file exactly
  const mismatches = out.filter((o, i) => o.merey_onchain !== rows[i].merey || o.brent_onchain !== rows[i].brent);

  const report = {
    network: `${network.name} (local simulation, chainId ${(await ethers.provider.getNetwork()).chainId})`,
    publisher: publisher.address,
    contracts: {
      "MEREY16/USD": await merey.getAddress(),
      "BRENT/USD": await brent.getAddress(),
      SpreadReader: await reader.getAddress(),
    },
    months_published: out.length,
    latest_merey: Number(ethers.formatUnits(latest, D)),
    gas_used: { deploy: gas.deploy.toString(), publish_all_months: gas.publish.toString(), publish_per_month_both_feeds: (gas.publish / BigInt(rows.length)).toString() },
    readback_matches_input: mismatches.length === 0,
  };
  fs.writeFileSync(path.join(__dirname, "..", "data", "onchain_readback.json"), JSON.stringify(out, null, 1));
  fs.writeFileSync(path.join(__dirname, "..", "data", "simulation_report.json"), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
