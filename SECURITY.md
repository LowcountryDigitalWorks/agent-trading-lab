# Security policy

## Scope

Release 0.4 is a deterministic forecast-research scaffold. Routine CI is offline and synthetic. The separately gated one-time source-qualification proof may issue only bounded unauthenticated public GET requests to the official Kalshi market-data REST API.

No secrets, API tokens, trading credentials, accounts, wallets, private keys, MFA/recovery material, customer data, PHI, CUI, payment data, or private LDW content are authorized.

There is no authorized path from a Phase 0B forecast record to real money, an order, a paper trade, or a position.

## Reporting

Do not open a public issue containing a secret or sensitive record. Report security concerns privately to Lowcountry Digital Works through the contact method published at https://lowcountrydigitalworks.com.

## Security invariants

- No authenticated Kalshi endpoint, API key, account creation, trading endpoint, order submission, wallet, or signing.
- No Gemini/OpenAI/Jev/other external model call or model credential in Release 0.4.
- Raw live Kalshi response bodies and bulk external market archives are not retained in the public repository or proof artifact.
- Secret scanning is part of CI.
- Runtime and development dependencies remain intentionally zero.
- Evidence integrity is append-only + hash-chained + tamper-evident, not WORM or immutable storage.
