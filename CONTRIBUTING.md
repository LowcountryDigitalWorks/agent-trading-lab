# Contributing

Release 0.1 is intentionally narrow. Before contributing, read `AGENTS.md` and `docs/EXPERIMENT_CONTRACT.md`.

Use a branch and pull request. Keep changes deterministic and add or update tests for contract behavior. Run:

```sh
npm ci
npm run verify
```

Do not add network clients, model providers, brokerage/exchange adapters, wallets/signing code, Freqtrade implementation code, PredictionMarketBench/PolyBench ingestion, credentials, customer data, or paid services without a separately accepted release gate.

Contributions are submitted under Apache License 2.0 unless explicitly marked otherwise.
