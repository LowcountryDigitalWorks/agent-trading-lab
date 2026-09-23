# Security policy

## Scope

Release 0.5 is an offline, deterministic source-contract scaffold. Routine CI uses only synthetic fixtures. **No operational CryptoStruct Data access is authorized** until a separate owner-license acceptance record and bounded live-proof authorization exist.

No secrets, API tokens, trading credentials, accounts, OAuth grants, wallets, private keys, MFA/recovery material, customer data, PHI, CUI, payment data, or private LDW content are authorized.

There is no authorized path from a Phase 0B forecast record to real money, an order, a paper trade, or a position.

## Reporting

Do not open a public issue containing a secret or sensitive record. Report security concerns privately to Lowcountry Digital Works through the contact method published at https://lowcountrydigitalworks.com.

## Security invariants

- No real CryptoStruct MCP/API data-returning call before the separate owner legal gate.
- No direct Polymarket/Kalshi call or fallback.
- No account, OAuth, Premium/purchase, paid realtime, model provider/call, trading endpoint, order submission, wallet, or signing.
- Public evidence must remain aggregate/non-reconstructive; raw CryptoStruct responses, per-market price datasets, full orderbooks, and reconstructive archives are prohibited.
- Future treatment context is source-separated and excludes CryptoStruct/Polymarket identity and all provider-derived market statistics.
- Secret scanning is part of CI.
- Runtime and development dependencies remain intentionally zero.
- Evidence integrity reuses the existing append-only + hash-chained + tamper-evident EvidenceEvent contract; it is not WORM or immutable storage.
