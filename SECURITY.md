# Security policy

## Scope

Release 0.1 is an offline deterministic research scaffold. It must not process or store secrets, API tokens, trading credentials, wallet seeds/private keys, MFA/recovery material, customer data, PHI, CUI, payment data, or production account data.

There is no authorized code path from a decision record to real money.

## Reporting

Do not open a public issue containing a secret or sensitive record. Report security concerns privately to Lowcountry Digital Works through the contact method published at https://lowcountrydigitalworks.com.

## Security invariants

- External network/model/exchange integrations are outside Release 0.1.
- Secret scanning is part of CI.
- Dependencies are intentionally zero for Release 0.1; `npm audit` remains in CI to fail if future dependency changes introduce known high-severity issues.
- Evidence integrity is hash-chained/tamper-evident, not WORM or immutable storage.
