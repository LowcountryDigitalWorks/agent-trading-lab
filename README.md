# Agent Trading Lab

Agent Trading Lab is a Lowcountry Digital Works experimental research repository for measuring whether bounded decision layers add value over deterministic baselines under identical evidence and risk assumptions.

Release 0.1 established deterministic measurement contracts and the evidence ledger. Releases 0.2–0.3 completed the bounded Phase 0A engineering measurement. Release 0.4 established the deterministic Phase 0B forecast-measurement harness. Release 0.5 established the CryptoStruct source-adapter scaffold. Release 0.5.1 normalized the observed live schema, but its replacement proof ended **BLOCKED** because browser execution destroyed exact call-accounting evidence. **Release 0.5.2 hardens proof control with a deterministic repository-owned runner; Stage 1 is offline/synthetic only.**

This remains experimental measurement infrastructure, not an alpha claim or investment product. Release 0.4 uses only bounded unauthenticated public Kalshi reads for source qualification and synthetic/mock treatment for forecast-harness tests.

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


## Release 0.4 Phase 0B foundation

Release 0.4 implements the market-midpoint control, deterministic one-market-per-event selector, T-24h/T-6h/T-1h schedule semantics, fail-closed source eligibility, mock treatment fallback, Brier/BSS/log-loss/calibration scoring, event-cluster bootstrap, robustness diagnostics, probability-stability helpers, and the future OOS-A/OOS-B state machine.

Routine CI remains offline and synthetic. Exactly one separately armed live qualification proof may issue at most 250 public unauthenticated GETs while inspecting at most 50 candidate events. Raw live response bodies are not retained in the repository or public proof artifact.

See [Release 0.4 Phase 0B harness and source qualification](docs/RELEASE_0_4_PHASE_0B_HARNESS.md).

## Release 0.5 CryptoStruct source adapter

Release 0.5 replaces the planned Phase 0B source boundary with a provider-neutral CryptoStruct adapter, initially limited to **Polymarket through CryptoStruct**. It implements the documented keyless MCP contract for `search_instruments`, `get_instrument`, and `get_market_snapshot`, deterministic IndependentEventSpec/source-quality/selector/resolution/evidence helpers, and synthetic fixtures.

Operational CryptoStruct Data access is deliberately hard-gated: this candidate makes **no real data-returning CryptoStruct call**. A future bounded live proof requires separate owner acceptance of the then-current CryptoStruct Data License plus ORCH4 authorization.

The exact control probability contract is `p_control = get_market_snapshot.last_price` for an eligible, unambiguously oriented binary YES/Up proposition. CryptoStruct-derived market data is excluded from future treatment context.

See [Release 0.5 CryptoStruct source adapter](docs/RELEASE_0_5_CRYPTOSTRUCT_SOURCE_ADAPTER.md).

## Release 0.5.1 live-schema normalization

Release 0.5.1 preserves the Release 0.5 BLOCKED result while correcting the adapter to the already observed CryptoStruct MCP contract. It parses the JSON-RPC `result.content[].text` envelope, normalizes `price_last` and nested `last_60m` fields, uses minimum-side bid/ask top-1 depth, adds a frozen VERIFIED `SourceMappingRecord`, and records schema/source-contract fingerprints without fabricating provider-version fields.

Stage 1 makes **zero additional CryptoStruct calls** and uses only synthetic fixtures plus offline deterministic CI. A replacement live proof, model-scored OOS, and trading remain separately gated.

See [Release 0.5.1 live-schema normalization](docs/RELEASE_0_5_1_CRYPTOSTRUCT_LIVE_SCHEMA_NORMALIZATION.md).

## Release 0.5.2 deterministic proof runner

Release 0.5.2 adds a repository-owned Node proof-control runner that durably reserves each Data-returning call attempt before dispatch, fsyncs an append-only hash-chained call ledger, enforces attempted-call and unique-candidate ceilings, applies per-call and proof-wide internal timeouts, reconciles interrupted reservations without redispatch, and always finalizes a sanitized manifest/artifact before CI upload.

Stage 1 makes **zero live CryptoStruct calls** and uses only injected synthetic transport plus offline deterministic tests. The merged Release 0.5.1 source semantics, quality thresholds, selector, IndependentEventSpec/SourceMappingRecord requirements, statistical contract, and model/OOS/trading exclusions remain unchanged.

See [Release 0.5.2 deterministic proof runner](docs/RELEASE_0_5_2_DETERMINISTIC_PROOF_RUNNER.md).

### Stage 2A operational entrypoint

Stage 2A adds a manual-only GitHub Actions entrypoint for a future separately
authorized Release 0.5.2 live proof. The entrypoint checks out an exact
ORCH4-authorized commit, validates the proof identity and frozen
source/discovery/selector hashes plus 45/50/10s/8m limits before the first
reservation, and uses a 15-minute outer job so reconciliation/finalization can
survive the internal proof deadline.

Stage 2A itself performs **zero live CryptoStruct calls**. The future live
entrypoint also requires an ORCH4-frozen, canonically hashed independent
semantic bundle built from valid `IndependentEventSpec` records plus exact
provider-neutral aliases. A completed initialized live proof retains an
aggregate-only `proof-summary.json` whose hash is bound into the proof
manifest/artifact hash. Preliminary QUALIFIED status requires at least one
single candidate that is both VERIFIED-mapped and passes every frozen source
quality threshold.

The workflow must not be dispatched until Product accepts/merges the candidate
and ORCH4 issues new exact one-proof authority for the resulting commit/tree,
hashes, proof ID, and semantic bundle.


## Release 0.5.3A offline CryptoStruct qualification redesign

Release 0.5.2 completed with an accepted **BLOCKED** source-qualification
result: the deterministic proof controls worked, but the frozen source/mapping
contract did not qualify. Release 0.5.3A is a separately gated **offline-only**
feasibility redesign under business-operations #281.

It adds three pre-source contracts:

- sanitized, value-free parser mismatch diagnostics;
- an IndependentEventSpec-first query/semantic plan that cannot be amended
  from provider observations;
- a conservative 30-unique-event quality-feasibility screen using the
  unchanged Release 0.5.2 quality thresholds.

Release 0.5.3A makes zero CryptoStruct Data-returning calls and does not
authorize Release 0.5.3B, model/OOS work, or trading.

See [Release 0.5.3A CryptoStruct qualification redesign](docs/RELEASE_0_5_3A_CRYPTOSTRUCT_QUALIFICATION_REDESIGN.md).


## Release 0.5.3B offline final-proof design

Release 0.5.3B turns the accepted 0.5.3A contracts into an executable
**offline-only** final source-qualification candidate. It freezes a real
40-event NOAA/NCEI weather universe, exactly eight provider-neutral search
queries, the semantic bundle, quality-screen configuration, parser-diagnostic
contract, call ceilings, and a release-specific integrity manifest before any
hypothetical provider access.

The future proof design remains a
`NON_INFERENTIAL_DETERMINISTIC_ENGINEERING_SCREEN`: search <=8,
get_instrument <=40, snapshots <=30, total Data-returning attempts <=78, one
snapshot per event, zero retries, and the first frozen quality rejection stops
immediately as INSUFFICIENT. The quality thresholds are unchanged.

The candidate adds a manual-only Release 0.5.3 workflow definition, but
Release 0.5.3B performs **zero CryptoStruct Data-returning calls** and does not
dispatch that workflow. A future live proof would require Product acceptance,
merge, fresh ORCH4 authority, current license/terms revalidation, and exact
commit/tree/hash/proof-ID freezing.

See [Release 0.5.3B final-proof design](docs/RELEASE_0_5_3B_FINAL_PROOF_DESIGN.md).
