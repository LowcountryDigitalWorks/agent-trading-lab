# Agent Trading Lab

Agent Trading Lab is a Lowcountry Digital Works experimental research repository for measuring whether bounded decision layers add value over deterministic baselines under identical evidence and risk assumptions.

Release 0.1 established the deterministic measurement contracts and evidence ledger. **Release 0.2 adds only the authorized Phase 0A public-data measurement integration**: Freqtrade `2026.8` as an external CLI/file-artifact source, Kraken public historical trades for BTC/USDT and ETH/USDT, deterministic 5m/1h normalization, EMA20/EMA50 control replay, fixed risk/cost/liquidity rules, and reproducible evidence.

This is a measurement/integration proof, **not an alpha claim**. It contains no external AI/model calls, prediction-market ingestion, exchange account or authenticated API access, paper/live order connectivity, wallets/signing, customer functionality, paid services, or real-capital path.

## Release 0.2 boundaries

- LDW-authored code: Apache-2.0.
- Freqtrade: GPLv3 external CLI/file-artifact boundary only; no implementation code is copied/imported/vendorized.
- Freqtrade release: `2026.8`, upstream commit `9f10e357a93c1dcf10c2a2b367659214d89c073e`.
- Source: Kraken spot public historical trades, BTC/USDT + ETH/USDT, 2026-08-01 through 2026-09-01 UTC (end exclusive).
- Quote volume: derived from `sum(price × amount)` in each 5m bucket, not `base volume × close`.
- Control: closed-1h EMA20/EMA50 transitions, no pyramiding, one position maximum per asset.
- Virtual risk: 10,000 starting units; 10% entry stake; 20% aggregate exposure; 2% daily-loss gate; 10% hard drawdown gate.
- Incremental cash cost: **$0**. Real capital: **$0**.
- Evidence remains **append-only + hash-chained + tamper-evident**, not WORM or cryptographically immutable.

Routine CI is synthetic and offline. The controlled one-time public-data proof is separately triggered and does not commit raw market datasets.

## Development

Requires Node.js 22 or later. There are no runtime or development package dependencies.

```sh
npm ci
npm run verify
```

See [the Release 0.2 public-data proof contract](docs/RELEASE_0_2_PUBLIC_DATA_PROOF.md), [the experiment contract](docs/EXPERIMENT_CONTRACT.md), [architecture notes](docs/ARCHITECTURE.md), and [dependency/license boundary](docs/DEPENDENCIES_AND_LICENSES.md).
