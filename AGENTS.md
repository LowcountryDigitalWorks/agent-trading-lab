# Repository instructions

This repository is the public research codebase for the Lowcountry Digital Works Agent Trading Lab.

Release 0.5 is limited to the **docs / synthetic-only** CryptoStruct source-adapter and evidence-qualification implementation authorized by `LowcountryDigitalWorks/business-operations#269`, building on accepted Release 0.4 main `e44203f5bdc5258f8acb30724c51e1e36b796402`.

## Boundaries

- Release 0.4 is accepted/merged/closed. Do not reopen the accepted Kalshi or Phase 0A experiments.
- Provider/source for Release 0.5 is CryptoStruct keyless Free MCP/analytics with **Polymarket only through CryptoStruct** as the initial underlying venue.
- Do not query direct Polymarket or Kalshi.
- Operational CryptoStruct Data access is **not authorized** in this release candidate. Do not make even one real data-returning MCP/API call until a separate owner-license acceptance record and live-proof authorization exist.
- The adapter may implement only the documented contract for `search_instruments`, `get_instrument`, and `get_market_snapshot`, using synthetic fixtures and injected tool boundaries.
- `p_control` is exactly an eligible snapshot's `last_price`; no midpoint, reciprocal ask, VWAP, close substitution, nearest-later observation, or historical rescue.
- Preserve the frozen T-24h / T-6h / T-1h timing and source-quality thresholds from #269/#263.
- IndependentEventSpec is the treatment-semantic source. CryptoStruct/Polymarket identity, prices, crowd probabilities, activity, spread, depth, and other provider-derived statistics must never enter future treatment context.
- No model/provider integration, model call, OOS-A/OOS-B start, account/OAuth, Premium/purchase, paid realtime, database, trading, execution, position sizing, P&L, wallet/signing, or real capital.
- Public repository evidence is aggregate/non-reconstructive only. No raw CryptoStruct responses, per-market price datasets, full orderbooks, or reconstructive archives.
- Runtime and development package dependencies should remain zero.
- Incremental cash and real capital remain $0.
- No customer data, PHI, CUI, payment data, credentials, or private LDW material.

Use a meaningful branch and PR. Routine CI must remain offline, synthetic, and deterministic. Development must not merge. A future live CryptoStruct proof is a separate owner/ORCH4 gate.
