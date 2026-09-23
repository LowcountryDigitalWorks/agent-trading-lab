# Release 0.1 architecture

Release 0.1 establishes an offline measurement boundary:

`synthetic candidate -> bounded decision record -> deterministic gate contract -> evidence event -> paired evaluator`

The codebase provides contracts and deterministic evidence mechanics only. Execution/replay integrations are interfaces for future releases; no market/exchange implementation is present.

## Deterministic layers

1. Versioned contract validation for candidates, decisions, gates, fills, evidence events, and manifests.
2. Canonical JSON serialization with lexicographically sorted object keys.
3. SHA-256 helpers over UTF-8 canonical content.
4. Append-only JSONL evidence writer and validator.
5. Paired evaluator requiring position-by-position identical candidate IDs.
6. Brier Score and Brier Skill Score for synthetic resolved-outcome fixtures.
7. Fail-closed treatment normalization.

## Ledger integrity vs reproducibility

The persisted evidence chain hashes each full record, including `recorded_at_utc`, and validates sequence plus prior-hash linkage. A separate reproducibility digest normalizes wall-clock-only `recorded_at_utc` and removes derived hash-link fields before hashing. This keeps persisted evidence tamper-evident while allowing equivalent runs to produce the same substantive digest.

## Future boundaries

Freqtrade, if later authorized, remains an external CLI/file-artifact boundary. No GPLv3 Freqtrade code is included or imported here. PredictionMarketBench and PolyBench are not Release 0.1 dependencies.

## Release 0.2 public-data measurement integration

Release 0.2 adds one deterministic external-artifact path:

`Freqtrade 2026.8 external CLI -> frozen Kraken public trades -> plain JSON trade/OHLCV artifacts -> LDW validation/normalization -> Phase 0A EMA20/EMA50 replay -> Release 0.1 evidence contracts`

Freqtrade remains outside the LDW-authored runtime dependency graph. Routine CI uses synthetic fixtures only. The controlled real-data proof runs separately, does not commit raw market datasets, and produces only sanitized manifests, hashes, diagnostics, metrics, and evidence artifacts.

Quote volume for the liquidity gate is derived from the public trade artifact as `sum(price * amount)` per 5m bucket. Decisions occur only after 1h candle close; nominal execution uses the first 5m bar strictly after the decision and stress adds one 5m bar.

## Release 0.3 paired executability layer

Release 0.3 parameterizes entry stake without changing the canonical 10% default. The shared normalized May-August dataset is converted once into a deterministic stake-independent signal stream. The same signal rows feed 10% control and 1% sensitivity replays under nominal and stress execution.

The signal-stream digest covers source hashes, closed-1h EMA state, transitions, exact T+5m/T+10m execution-bucket identity, bucket availability and quote volume. Downstream portfolio state is intentionally allowed to diverge after stake-dependent accept/reject outcomes.

Scale-conversion diagnostics pair bullish entry opportunities by stake-independent opportunity ID and execution timestamp. They never infer causality from aggregate fill counts alone.

## Release 0.4 Phase 0B forecast layer

Release 0.4 adds a separate read-only forecast-measurement path while leaving Phase 0A closed:

`Kalshi public REST -> fail-closed source adapter -> deterministic one-market-per-event selector -> midpoint p_control -> CandidateEnvelope v1 track 0B -> mock treatment/fallback -> paired forecast metrics -> clustered robustness -> existing EvidenceEvent/RunManifest`

The source adapter performs decimal-safe top-of-book math from YES/NO bid ladders and never invents asks independently. Planned T-24h/T-6h/T-1h cutoff semantics are deterministic contracts only; real OOS collection is not started.

The OOS-A/OOS-B state machine, one-redesign rule, bootstrap, robustness and stability helpers define future evaluation mechanics without invoking a model.

Routine CI remains synthetic/offline. The one live source-qualification workflow is explicitly marker-gated and retains only sanitized aggregate evidence, not raw Kalshi payloads.

## Release 0.5 CryptoStruct source boundary

Release 0.5 adds a provider-neutral prediction-market source adapter without changing the existing Phase 0B forecast/statistical harness:

`IndependentEventSpec -> CryptoStruct source adapter -> Polymarket instrument orientation -> source-quality gate -> exact last_price p_control -> existing Phase 0B scoring/evidence`

The adapter exposes provider-neutral `searchInstruments`, `getInstrument`, and `getMarketSnapshot` operations backed by an injected MCP tool-invocation function. The implementation itself contains no network client and is hard-gated with `OWNER_LICENSE_ACCEPTANCE_REQUIRED` unless a later caller explicitly supplies separately authorized operational access.

The initial underlying venue is Polymarket only through CryptoStruct. Direct Polymarket/Kalshi access does not exist in this release.

IndependentEventSpec is created before T-24h from independent sources and is the only semantic route to a future treatment model. CryptoStruct/venue identity, instrument identifiers, `last_price` / `p_control`, trade count, turnover, spread, depth, liquidity, and every other provider-derived statistic remain on the control/evidence side and are excluded from treatment context.

Private cutoff evidence reuses the existing EvidenceEvent v1 hash chain. Public evidence is a separate sanitized aggregate schema and cannot contain per-market pricing/activity fields or reconstructive source data.

