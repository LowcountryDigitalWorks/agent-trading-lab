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
