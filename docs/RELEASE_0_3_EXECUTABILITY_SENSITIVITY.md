# Release 0.3 — Phase 0A executability sensitivity

Release 0.3 is a bounded engineering measurement authorized by `LowcountryDigitalWorks/business-operations#251`. It tests whether the existing real-data fill/cost/portfolio lifecycle becomes executable at one predeclared smaller virtual stake while preserving the Release 0.2 liquidity constraint and all other experiment rules.

It is **not** a strategy-alpha experiment. The May–August interval is engineering coverage data and must not later be represented as independent strategy-edge or out-of-sample evidence.

## Frozen paired design

Exactly two stake configurations are allowed:

- canonical control: 10% of then-current virtual equity;
- engineering sensitivity: 1% of then-current virtual equity.

The default Phase 0A stake remains 10%. Release 0.3 parameterizes the replay engine; it does not replace the default.

The source window is frozen to `2026-05-01T00:00:00Z` through `2026-08-01T00:00:00Z`, end exclusive. One Freqtrade acquisition and one normalization set feed both variants.

Source/runtime boundaries remain Freqtrade `2026.8` as an external GPLv3 CLI/file-artifact producer, Kraken spot public historical data, BTC/USDT and ETH/USDT, 5m and 1h, with no account, API key, credentials, or authenticated Kraken access.

## Shared signal stream

A stake-independent signal stream is created once from the normalized artifacts. It records source hashes, pair, source candle, decision time, EMA20/EMA50 values, crossover transition, exact nominal T+5m execution bucket, exact stress T+10m bucket, bucket availability, and quote volume when available.

The canonical serialization of this stream is SHA-256 hashed as the **signal-stream digest**. All four scenario runs consume the same in-memory signal rows. Portfolio state is allowed to diverge after a stake-dependent accept/reject outcome; CandidateEnvelope state hashes and later position-dependent decisions are not incorrectly forced to match after that point.

## Scale-conversion diagnostic

Every bullish entry opportunity is paired between the 10% control and 1% sensitivity for the same cost/latency scenario. Diagnostics record:

- opportunity ID, pair, and decision timestamp;
- exact required execution timestamp;
- execution-bucket quote volume;
- 10% desired order notional;
- 1% desired order notional;
- each stake's liquidity result and actual entry result.

A **scale-conversion entry** exists only when the 10% control is rejected specifically for `liquidity_limit` and the 1% sensitivity is accepted on the same opportunity and execution bucket.

## Unchanged invariants

Release 0.2 behavior remains the default. Starting virtual equity is 10,000. Signals use closed 1h EMA20/EMA50 crossovers. There is no pyramiding, at most one position per asset, a 20% aggregate exposure ceiling, 2% UTC-day loss gate, and 10% experiment drawdown gate.

Nominal execution is exact T+5m. Stress execution is exact T+10m. Missing exact buckets fail closed to `missing_execution_data / SKIP`. Nominal costs remain 10 bps fee + 2 bps half-spread + 3 bps slippage. Stress remains 10 + 5 + 10 bps plus one additional 5m latency. Liquidity remains order notional <= 0.1% of execution-bucket quote volume derived from `sum(price * amount)` public trade rows. No partial fills, leverage, or shorting are introduced.

Release 0.1 CandidateEnvelope, DecisionRecord, GateResult, FillRecord, EvidenceEvent, and RunManifest contracts remain authoritative. Evidence remains append-only, hash-chained, and tamper-evident.

## Engineering outputs and classification

Each of the four scenarios—10% nominal, 10% stress, 1% nominal, and 1% stress—reports accepted/rejected entries and exits, complete round trips, rejection reasons, fill-path coverage, cash/position/equity/exposure transitions, execution-cost drag, evidence-chain validity, canonical digest, source hashes, and the shared signal-stream digest.

The 1% nominal and stress scenarios are independently successful only when they each contain at least one scale-conversion accepted entry, an accepted BUY, an accepted SELL closing a sensitivity-opened position, a complete round trip, real fill/cost evidence, observable state transitions, a valid evidence chain, and a reproducible canonical digest.

Classification is frozen:

- **FULL PASS**: both 1% nominal and 1% stress meet the lifecycle criteria.
- **PARTIAL PASS**: exactly one meets them.
- **NEGATIVE**: neither meets them.

All three are valid results. P&L is secondary diagnostic output only and is not used to classify success, choose stake, change parameters, justify another experiment, or claim alpha.

## No optimization

Exactly one sensitivity and one historical window are authorized. After the classification, stop. Do not try other stake sizes, another liquidity limit, another window, other assets, EMA changes, strategy changes, alternate costs/latency, partial fills, hyperopt, or any return-seeking parameter sweep.

Routine CI remains synthetic/offline. The one controlled real-data proof is isolated in `.github/workflows/release03-executability-proof.yml` and is triggered only by the explicit `RUN_RELEASE03_PROOF=1` PR marker. Raw market data is not committed or retained in the sanitized proof artifact.
