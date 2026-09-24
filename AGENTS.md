# Repository instructions

This repository is the public research codebase for the Lowcountry Digital Works Agent Trading Lab.

Release 0.5.2 is the proof-control hardening release authorized by `LowcountryDigitalWorks/business-operations#275`, based on accepted main `5503b7732db6e3b6d578768f513d544389ef2c37`.

## Boundaries

- Release 0.5.1 is historically complete with final result **BLOCKED** because the browser proof lost exact call-accounting evidence. CryptoStruct was not rejected and the merged 0.5.1 normalization was not disproven.
- Release 0.5.2 Stage 1 is accepted/merged. Stage 2A permits only the repository-owned manual live-proof entrypoint, docs, synthetic/offline tests, and CI/workflow validation under business-operations #275 comment 5823286867.
- Live CryptoStruct calls are **not authorized** during Stage 2A. The prior Stage 2 live authority at #275 comment 5815796874 is suspended and must not be exercised. Do not use browser automation for source qualification.
- Future source remains CryptoStruct keyless MCP with Polymarket only through CryptoStruct.
- Allowed future Data-returning tools remain only `search_instruments`, `get_instrument`, and `get_market_snapshot`.
- Attempt authority must be durably reserved before dispatch; reserved sequences are never reused.
- Every reservation must end exactly once as SUCCESS, HTTP_ERROR, MCP_ERROR, TIMEOUT, PARSE_ERROR, or RUNNER_ABORTED_AFTER_RESERVATION.
- Frozen call/candidate budgets and internal timeouts must be enforced by runner code, not operator judgment.
- `IndependentEventSpec`, VERIFIED `SourceMappingRecord`, `p_control = raw.price_last`, the Release 0.5.1 quality thresholds, selector, and statistical contract remain unchanged.
- No threshold/category/source redesign, model/OOS/trading/P&L, account/OAuth/Premium/purchase, database, or customer functionality.
- Sanitized proof artifacts may contain ledgers, hashes, fingerprints, counts, and classification, but no raw provider response corpus or reconstructive market dataset.
- Runtime and development package dependencies should remain zero; incremental cash and real capital remain $0.

Use a meaningful branch and PR. Routine CI must remain offline, synthetic, and deterministic. Development must not merge. The Stage 2A live workflow must remain workflow_dispatch-only and must not be dispatched during implementation/review. Any future live proof requires Product merge followed by fresh ORCH4 authority, exact merged identity/hash freezing, and current license/terms revalidation.
