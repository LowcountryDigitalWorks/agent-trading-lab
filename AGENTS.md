# Repository instructions

Current authorized work is **Release 0.5.3B — OFFLINE FINAL-PROOF DESIGN / INTEGRATION REVIEW** under `LowcountryDigitalWorks/business-operations#281`, authority comment `5835962405`.

Release 0.5.3A is accepted/merged on main `c47c61be3b0dafdf3db1d06a7671150b29e6a980`. Release 0.5.2 remains closed/completed with final disposition **BLOCKED — ACCEPTED**; its one-proof authority is consumed and must not be reused.

## Release 0.5.3B current boundary

- CryptoStruct Data-returning calls: **ZERO**.
- Do not call `search_instruments`, `get_instrument`, `get_market_snapshot`, or any other CryptoStruct source tool during this release.
- Do not access Polymarket or Kalshi directly.
- Authorized work is repository code/docs/schemas, deterministic synthetic fixtures/tests, CI, merged 0.5.3A contracts, retained sanitized 0.5.2 evidence, read-only authoritative non-market public references for independent event definition, and definition/validation of a future manual workflow that is **not dispatched**.
- Current engineering screen remains `NON_INFERENTIAL_DETERMINISTIC_ENGINEERING_SCREEN`.
- Frozen future ceilings remain search <=8, get_instrument <=40, snapshots <=30, total Data-returning attempts <=78, one snapshot/event, zero retry.
- Frozen quality thresholds remain trades >=5, turnover >=100 USD, spread <=2000 bps, minimum-side top-1 depth >=50 USD.
- IndependentEventSpec/event universe, query plan, semantic aliases, hashes, and category authority must be frozen before any hypothetical future provider access.
- No provider hindsight, fuzzy/LLM/probability-assisted semantic mapping, threshold tuning, rescue after a quality rejection, or live query widening.
- No live workflow dispatch, model/OOS-A/OOS-B, trading/orders/P&L, database, account/OAuth/Premium/purchase, or customer functionality.
- Development works on a branch/PR and **does not merge**.
- Incremental cash and real capital remain $0.


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
