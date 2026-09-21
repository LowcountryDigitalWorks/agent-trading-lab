# Security policy

## Scope

Release 0.3 remains a deterministic research scaffold. Routine CI is offline; the separately gated Release 0.3 proof may download only the frozen 2026-05-01 through 2026-08-01 public Kraken historical dataset through the pinned external Freqtrade CLI. It must not process or store secrets, API tokens, trading credentials, wallet seeds/private keys, MFA/recovery material, customer data, PHI, CUI, payment data, or production account data.

There is no authorized code path from a decision record to real money.

## Reporting

Do not open a public issue containing a secret or sensitive record. Report security concerns privately to Lowcountry Digital Works through the contact method published at https://lowcountrydigitalworks.com.

## Security invariants

- Authenticated exchange/network integrations, accounts, model providers, paper/live order paths, wallets, and signing remain outside Release 0.3.
- Secret scanning is part of CI.
- Dependencies are intentionally zero for Release 0.1; `npm audit` remains in CI to fail if future dependency changes introduce known high-severity issues.
- Evidence integrity is hash-chained/tamper-evident, not WORM or immutable storage.
