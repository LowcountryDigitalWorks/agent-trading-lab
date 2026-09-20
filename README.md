# Agent Trading Lab

Agent Trading Lab is a Lowcountry Digital Works experimental research repository for measuring whether a bounded decision layer adds value over deterministic baselines under identical evidence and risk assumptions.

**Release 0.1 is measurement infrastructure only.** It contains versioned contracts, canonical serialization and hashing, a tamper-evident evidence ledger, frozen run-manifest utilities, paired evaluation helpers, Brier metrics, synthetic fixtures, and deterministic tests.

It does **not** contain exchange connectivity, historical exchange downloads, brokerage connectivity, wallet/signing code, Freqtrade integration, prediction-market ingestion, external AI/model calls, paper/live trading, customer functionality, or any real-capital path.

## Release 0.1 boundaries

- Public research code; Apache-2.0 for LDW-authored code.
- Synthetic fixtures only.
- Incremental cash cost: **$0**.
- Real capital: **$0**.
- Treatment failures (`invalid`, `timeout`, `unavailable`) fail closed to `SKIP`.
- Prediction-scoring failures preserve the frozen fallback: treatment probability equals the paired control probability.
- Evidence storage is **append-only + hash-chained + tamper-evident**. It is not WORM storage and is not described as cryptographically immutable.

## Canonical evidence behavior

Each persisted ledger record includes `recorded_at_utc` in its integrity hash, so changing the persisted timestamp is detectable. Reproducibility comparisons use `canonicalLedgerDigest`, which intentionally normalizes wall-clock-only metadata and omits derived chain hashes while retaining substantive event content. Equivalent synthetic runs can therefore compare deterministically without hiding substantive evidence.

## Canonical thresholds

- Treatment stability: **>=90%** exact action agreement.
- Locked OOS floor: **>=300** paired eligible decisions.
- Resolved-event floor: **>=100** unique resolved events.
- Forward paper: **>=30 calendar days AND >=100 eligible treatment decisions**.

These are future experiment gates documented here for contract continuity; Release 0.1 does not perform a trading experiment.

## Development

Requires Node.js 22 or later. There are no runtime or development package dependencies.

```sh
npm ci
npm run verify
```

See [the experiment contract](docs/EXPERIMENT_CONTRACT.md), [architecture notes](docs/ARCHITECTURE.md), and [dependency/license boundary](docs/DEPENDENCIES_AND_LICENSES.md).
