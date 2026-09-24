# Contributing

Release 0.5.2 is the deterministic proof-control hardening release authorized by business-operations #275 and builds on accepted main `5503b7732db6e3b6d578768f513d544389ef2c37`. Before contributing, read `AGENTS.md`, `docs/EXPERIMENT_CONTRACT.md`, `docs/RELEASE_0_5_1_CRYPTOSTRUCT_LIVE_SCHEMA_NORMALIZATION.md`, and `docs/RELEASE_0_5_2_DETERMINISTIC_PROOF_RUNNER.md`.

Use a branch and pull request. Keep routine validation deterministic, offline, and synthetic. Run:

```sh
npm ci
npm run verify
npm run proof:synthetic
```

Do not make any live CryptoStruct call during Stage 1. Do not use browser automation for a source proof, query direct Polymarket/Kalshi, add a model/provider, begin OOS collection, add trading/P&L, add credentials/accounts/OAuth/Premium/purchases, add a database, or change source/category/statistical thresholds without a separately accepted gate.

Release 0.5.1 remains historically BLOCKED. Release 0.5.2 fixes proof-control durability only; it does not change the source or statistical contract.

Contributions are submitted under Apache License 2.0 unless explicitly marked otherwise.
