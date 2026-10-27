# API16 Merey Feed (draft v0.1)

An open, on-chain monthly price feed for **Merey 16**, Venezuela's reference crude, alongside **Brent**.

Merey does not trade on any exchange. Its price is assessed, published late and scattered across reports. API16 publishes the monthly average on-chain, with the month it covers, whether the figure was reported or derived, and a link to its public source.

> Status: **draft**. Runs on a local simulated network only. Not deployed, not audited. Do not use it to secure value. Not financial advice.

## What's inside

| File | What it does |
|---|---|
| `contracts/API16PriceFeed.sol` | One feed per crude (e.g. `MEREY16 / USD`, `BRENT / USD`). Same read interface as a Chainlink price feed (`latestRoundData`, `getRoundData`, `decimals`, `description`), so existing apps can read it unchanged. Extras: month (`YYYYMM`), data type (reported / derived), source URL, public corrections. |
| `contracts/API16SpreadReader.sol` | Reads two feeds and returns the discount for a month (Brent − Merey). Shows how other contracts can build on the feeds. |
| `contracts/AggregatorV3Interface.sol` | The Chainlink-compatible read interface. |
| `test/API16PriceFeed.test.js` | Tests: publishing, permissions, month ordering, corrections, ownership, spread. |
| `scripts/simulate.js` | Deploys on a local network, publishes every month from the data file, reads it all back and checks it matches. |
| `data/merey_brent_monthly.json` | Monthly averages Jan 2025 – Sep 2026 with sources. |
| `data/onchain_readback.json` | What the contracts returned in the simulation. |

## Run it

```bash
npm install --legacy-peer-deps
npm test           # 7 tests
npm run simulate   # deploy + publish 21 months + read back, on a local network
```

No wallet or keys needed for any of this.

## Data notes

- Merey: OPEC monthly averages as published by Venezuelan press (Finanzas Digital, Revista Economía, Banca y Negocios). Apr, May and Jul 2026 are **derived** from reported month-on-month changes and flagged as such on-chain.
- Brent: U.S. EIA, Europe Brent Spot Price FOB, monthly.
- Prices use 8 decimals (`93.75` → `9375000000`).

## Next steps

1. Deploy to **Base Sepolia** (testnet) from a dedicated publisher wallet.
2. Verify the contracts on the block explorer.
3. Publish monthly when OPEC releases its report.
4. Later: multisig publisher, cheaper source storage (hash + URL off-chain), independent audit before any mainnet use.

## License

MIT
