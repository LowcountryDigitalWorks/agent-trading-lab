# Agent Trading Lab

Agent Trading Lab is a Lowcountry Digital Works experimental research repository for measuring whether bounded decision layers add value over deterministic baselines under identical evidence and risk assumptions.

Release 0.1 established deterministic measurement contracts and the evidence ledger. Release 0.2 proved the public-data measurement integration. **Release 0.3 adds only the authorized Phase 0A executability sensitivity**: the canonical 10% stake is paired with one predeclared 1% engineering sensitivity on one shared May-August Kraken public dataset, with every Release 0.2 liquidity, execution, cost, risk and evidence invariant preserved.

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

## Release 0.3 executability sensitivity

Release 0.3 uses one acquisition/normalization dataset for both stake variants and records a stake-independent signal-stream digest plus paired scale-conversion diagnostics. It produces four scenarios: 10% nominal, 10% stress, 1% nominal, and 1% stress. A scale-conversion entry is counted only when the 10% control is rejected for `liquidity_limit` while the 1% sensitivity is accepted on the same signal opportunity and exact execution bucket.

The frozen engineering coverage window is 2026-05-01 through 2026-08-01 UTC, end exclusive. The 1% value is not a new default, and the window is not strategy-edge/OOS evidence. FULL PASS, PARTIAL PASS and NEGATIVE are all valid engineering outcomes; no result authorizes an automatic second sensitivity.

See [Release 0.3 executability sensitivity](docs/RELEASE_0_3_EXECUTABILITY_SENSITIVITY.md).
