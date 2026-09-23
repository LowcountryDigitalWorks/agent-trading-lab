# Contributing

Release 0.4 is intentionally narrow and builds on accepted Release 0.3 main. Before contributing, read `AGENTS.md`, `docs/EXPERIMENT_CONTRACT.md`, and `docs/RELEASE_0_4_PHASE_0B_HARNESS.md`.

Use a branch and pull request. Keep routine validation deterministic and offline. Run:

```sh
npm ci
npm run verify
```

Do not alter accepted Phase 0A behavior. Do not add model providers/calls, credentials, authenticated Kalshi access, prediction-market trading/execution/P&L, OOS collection, PolyBench ingestion, customer data, or paid services without a separately accepted gate.

Release 0.4 permits only the forecast harness plus the bounded public unauthenticated Kalshi source qualification authorized by business-operations #258.

Contributions are submitted under Apache License 2.0 unless explicitly marked otherwise.
