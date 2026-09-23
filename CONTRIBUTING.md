# Contributing

Release 0.5 is intentionally narrow and builds on accepted Release 0.4 main `e44203f5bdc5258f8acb30724c51e1e36b796402`. Before contributing, read `AGENTS.md`, `docs/EXPERIMENT_CONTRACT.md`, and `docs/RELEASE_0_5_CRYPTOSTRUCT_SOURCE_ADAPTER.md`.

Use a branch and pull request. Keep routine validation deterministic, offline, and synthetic. Run:

```sh
npm ci
npm run verify
```

Do not make an operational CryptoStruct Data call, accept provider terms on the owner's behalf, query direct Polymarket/Kalshi, add a model/provider, begin OOS collection, add trading/P&L, add credentials/accounts/OAuth/Premium/purchases, add a database, or broaden source/category/statistical thresholds without a separately accepted gate.

Release 0.5 permits only the docs/synthetic CryptoStruct source-adapter and evidence-qualification scope authorized by business-operations #269.

Contributions are submitted under Apache License 2.0 unless explicitly marked otherwise.
