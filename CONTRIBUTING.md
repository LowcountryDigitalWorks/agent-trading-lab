# Contributing

Release 0.3 remains intentionally narrow and builds on the accepted Release 0.2 measurement integration. Before contributing, read `AGENTS.md` and `docs/EXPERIMENT_CONTRACT.md`.

Use a branch and pull request. Keep changes deterministic and add or update tests for contract behavior. Run:

```sh
npm ci
npm run verify
```

Do not add model providers, brokerage/exchange account adapters, authenticated exchange access, wallets/signing code, Freqtrade implementation code, PredictionMarketBench/PolyBench ingestion, credentials, customer data, paid services, or strategy optimization without a separately accepted release gate. Release 0.3 permits only the bounded two-stake executability sensitivity described in docs/RELEASE_0_3_EXECUTABILITY_SENSITIVITY.md.

Contributions are submitted under Apache License 2.0 unless explicitly marked otherwise.
