# Repository instructions

This repository is the public research codebase for the Lowcountry Digital Works Agent Trading Lab.

Release 0.5.2 is the proof-control hardening release authorized by `LowcountryDigitalWorks/business-operations#275`, based on accepted main `5503b7732db6e3b6d578768f513d544389ef2c37`.

## Boundaries

- Release 0.5.1 is historically complete with final result **BLOCKED** because the browser proof lost exact call-accounting evidence. CryptoStruct was not rejected and the merged 0.5.1 normalization was not disproven.
- Release 0.5.2 Stage 1 permits only repository code, schemas, synthetic fixtures/tests, and offline deterministic CI.
- Live CryptoStruct calls are **not authorized** in Stage 1. Do not use browser automation for source qualification.
- Future source remains CryptoStruct keyless MCP with Polymarket only through CryptoStruct.
- Allowed future Data-returning tools remain only `search_instruments`, `get_instrument`, and `get_market_snapshot`.
- Attempt authority must be durably reserved before dispatch; reserved sequences are never reused.
- Every reservation must end exactly once as SUCCESS, HTTP_ERROR, MCP_ERROR, TIMEOUT, PARSE_ERROR, or RUNNER_ABORTED_AFTER_RESERVATION.
- Frozen call/candidate budgets and internal timeouts must be enforced by runner code, not operator judgment.
- `IndependentEventSpec`, VERIFIED `SourceMappingRecord`, `p_control = raw.price_last`, the Release 0.5.1 quality thresholds, selector, and statistical contract remain unchanged.
- No threshold/category/source redesign, model/OOS/trading/P&L, account/OAuth/Premium/purchase, database, or customer functionality.
- Sanitized proof artifacts may contain ledgers, hashes, fingerprints, counts, and classification, but no raw provider response corpus or reconstructive market dataset.
- Runtime and development package dependencies should remain zero; incremental cash and real capital remain $0.

Use a meaningful branch and PR. Routine CI must remain offline, synthetic, and deterministic. Development must not merge. Any future live proof requires fresh ORCH4 authority and current license/terms revalidation.
