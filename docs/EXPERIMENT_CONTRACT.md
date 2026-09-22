# Agent Trading Lab experiment contract — Release 0.1

This document preserves the accepted Phase 0 measurement contract while implementing only the Release 0.1 scaffold authorized in `LowcountryDigitalWorks/business-operations#246`.

## Research question

Does a bounded AI decision layer improve a deterministic trading/forecasting baseline after realistic execution costs, proper out-of-sample testing, and identical risk controls?

A result showing no useful AI edge is an acceptable experiment outcome.

## Frozen future experiment assumptions

Phase 0A liquid-market control, when separately authorized, uses BTC/USDT and ETH/USDT spot, no leverage/shorting, deterministic EMA20/EMA50 candidate generation, a 10,000-unit virtual starting equity, fixed 10% entry stake, max 20% aggregate exposure, a 2% start-of-day virtual-equity daily-loss gate, and a 10% hard experiment drawdown gate.

The accepted nominal per-side friction is 10 bps fee + 2 bps half-spread + 3 bps slippage, with next eligible 5m-bar execution after a closed 1h decision candle. The stress case is 10 bps fee + 5 bps half-spread + 10 bps slippage plus one additional 5m bar of latency. Release 0.1 does not implement this replay.

Phase 0B, when separately authorized, uses market midpoint as the forecast control. Valid treatment forecasts are bounded to `p_yes` in `[0.01, 0.99]`. Invalid/timeout/unavailable treatment output becomes `SKIP`, while prediction scoring uses `p_treatment = p_control`. A deterministic future action gate uses an accepted primary edge threshold of 0.03, with sensitivity at 0.02 and 0.04. Release 0.1 implements only these fail-closed scoring semantics and metric primitives.

## Versioned Release 0.1 contracts

- CandidateEnvelope v1
- DecisionRecord v1
- GateResult v1
- FillRecord v1
- EvidenceEvent v1
- RunManifest v1

Machine-readable schemas are under `schemas/`; runtime validation is in `src/contracts.mjs` and `src/manifest.mjs`.

## Candidate availability rule

Every feature and context reference must include `available_at_utc`, and it must be less than or equal to the candidate `observation_cutoff_utc`. Resolved outcomes are not candidate input.

## Evidence ledger

Evidence event types are:

`run_started`, `candidate`, `decision`, `gate`, `fill`, `resolution`, `metric`, `run_closed`.

Persisted records contain `run_id`, `sequence`, `event_type`, `recorded_at_utc`, `payload`, `prev_record_hash`, and `record_hash`. Record hashes use SHA-256 over canonical serialized record content excluding only `record_hash` itself. Validation checks sequence, recomputed record hash, and exact previous-link continuity.

The ledger is append-only + hash-chained + tamper-evident. It is not WORM storage and no cryptographic immutability claim is made.

## Manifest provenance

A frozen run manifest records source identity/version, canonical upstream reference, retrieval timestamp, license/terms reference, coverage, counts, timezone, raw-input hashes, parent hashes for derived artifacts, transform commit, integration refs, model/prompt/schema/adapter versions, deterministic seeds, Git commit, environment lock hash, execution/cost configuration, chronological partitions, and allowed redesign count.

For the synthetic Release 0.1 fixture, these fields are populated with synthetic/local provenance rather than silently omitted.

## Chronological partition rule

Future model-scored data is frozen by event group in chronological order: 50% train, 20% dev, 15% locked OOS-A, 15% locked OOS-B. The same event may not cross partitions. OOS-B remains unopened except under the accepted confirmation/redesign rules.

## Canonical thresholds

- Treatment stability: >=90% exact action agreement.
- Locked OOS: >=300 paired eligible decisions.
- Unique resolved events: >=100.
- Forward paper: >=30 calendar days AND >=100 eligible treatment decisions.

The accepted Phase 0B pass gate also requires Brier Skill Score vs market >=0.02, positive paired-improvement confidence evidence, robustness across eligible predeclared folds, nominal after-cost incremental P&L >0, stressed incremental P&L >=0, no reversal after removing the top 1–3 positive-contribution outcomes, deterministic risk-gate compliance, included model cost, and retained forward-paper probability skill plus nonnegative after-cost incremental P&L.

Exactly one redesign is allowed after OOS-A failure; evaluation rules cannot be changed to rescue the result.

## Release 0.1 exclusions

No Freqtrade integration, market downloads, PredictionMarketBench integration, PolyBench ingestion, external model/API calls, brokerage/exchange connectivity, automated paper/live trading, wallet/signing code, Robinhood Chain, Pons, customer functionality, credentials, secrets, paid services, or real capital.

## Release 0.2 implementation status

Release 0.2 implements only the frozen Phase 0A measurement integration described above for Kraken spot public historical data, BTC/USDT and ETH/USDT, from 2026-08-01T00:00:00Z through 2026-09-01T00:00:00Z (end exclusive). The Phase 0B/model assumptions in this document remain future contract material and are not implemented by Release 0.2.

The Phase 0A replay uses closed 1h EMA20/EMA50 transitions, nominal first-eligible-5m execution strictly after decision close, the accepted nominal/stress costs, the accepted virtual risk envelope, and a quote-volume liquidity gate derived from public trade cost `price * amount`. This remains a measurement proof and not an alpha claim.

## Release 0.3 engineering sensitivity

Release 0.3 does not change the Phase 0A strategy, execution, liquidity, cost, or risk contract. It parameterizes entry stake so the canonical 10% control and one predeclared 1% engineering sensitivity can be replayed against one shared 2026-05-01 through 2026-08-01 public-data normalization set.

The two variants share a deterministic stake-independent signal-stream digest. Portfolio state may diverge after stake-dependent accept/reject outcomes, so downstream CandidateEnvelope state hashes and position-dependent decisions are not required to remain identical.

A scale-conversion entry is recognized only when the 10% control is rejected for `liquidity_limit` and the 1% sensitivity is accepted on the same bullish signal opportunity and exact execution bucket. FULL PASS, PARTIAL PASS, and NEGATIVE are all valid engineering classifications. P&L is secondary diagnostic output and not strategy-edge evidence.

