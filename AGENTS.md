# Repository instructions

This repository is the public research codebase for the Lowcountry Digital Works Agent Trading Lab.

Release 0.5.1 is the bounded CryptoStruct live-schema normalization correction authorized by `LowcountryDigitalWorks/business-operations#272`, based on accepted main `61ce4cc9841f8aef58c9da18f3af21c1f02c609e`.

## Boundaries

- Release 0.5 remains historically complete with final source result **BLOCKED**.
- Stage 1 permits only documentation, code, schemas, synthetic fixtures, and offline deterministic CI.
- Additional live CryptoStruct calls are **not authorized**; the unused #269 call budget is dead authority.
- Provider/source remains CryptoStruct keyless MCP with Polymarket only through CryptoStruct.
- `IndependentEventSpec` remains category/deadline/resolution authority; search is discovery only.
- A VERIFIED private `SourceMappingRecord` is required for event-level source admission.
- `p_control = raw.price_last`; quality uses nested `last_60m` fields and minimum-side top-1 depth.
- No threshold/sample-floor reduction, model/OOS/trading/P&L, account/OAuth/Premium/purchase, database, or customer functionality.
- Public evidence remains aggregate/non-reconstructive.
- Runtime and development dependencies remain zero; incremental cash and real capital remain $0.

Use a meaningful branch and PR. Routine CI must remain offline, synthetic, and deterministic. Development must not merge. Any replacement live proof requires new ORCH4 authority.
