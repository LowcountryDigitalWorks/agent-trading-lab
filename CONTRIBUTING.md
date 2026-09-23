# Contributing

Release 0.5.1 is the bounded live-schema normalization correction authorized by business-operations #272 and builds on accepted main `61ce4cc9841f8aef58c9da18f3af21c1f02c609e`. Before contributing, read `AGENTS.md`, `docs/EXPERIMENT_CONTRACT.md`, and `docs/RELEASE_0_5_1_CRYPTOSTRUCT_LIVE_SCHEMA_NORMALIZATION.md`.

Use a branch and pull request. Keep routine validation deterministic, offline, and synthetic. Run:

```sh
npm ci
npm run verify
```

Do not make any live CryptoStruct call during Stage 1. Do not query direct Polymarket/Kalshi, add a model/provider, begin OOS collection, add trading/P&L, add credentials/accounts/OAuth/Premium/purchases, add a database, or broaden source/category/statistical thresholds without a separately accepted gate.

Release 0.5 remains historically BLOCKED; Release 0.5.1 corrects only the Product-frozen normalization contract.

Contributions are submitted under Apache License 2.0 unless explicitly marked otherwise.
