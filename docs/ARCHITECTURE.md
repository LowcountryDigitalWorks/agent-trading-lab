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

