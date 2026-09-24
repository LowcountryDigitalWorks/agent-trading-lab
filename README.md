# Agent Trading Lab

Agent Trading Lab is a Lowcountry Digital Works experimental research repository for measuring whether bounded decision layers add value over deterministic baselines under identical evidence and risk assumptions.

Release 0.1 established deterministic measurement contracts and the evidence ledger. Releases 0.2–0.3 completed the bounded Phase 0A engineering measurement. Release 0.4 established the deterministic Phase 0B forecast-measurement harness. Release 0.5 established the CryptoStruct source-adapter scaffold and its single live source proof ended **BLOCKED** on live-schema mismatch. **Release 0.5.1 is the bounded offline normalization correction authorized by #272**. It adds no model, OOS, trading, or P&L scope.

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
