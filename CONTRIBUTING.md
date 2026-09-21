# Contributing

Release 0.2 remains intentionally narrow and builds on the accepted Release 0.1 contracts. Before contributing, read `AGENTS.md` and `docs/EXPERIMENT_CONTRACT.md`.

Use a branch and pull request. Keep changes deterministic and add or update tests for contract behavior. Run:

```sh
npm ci
npm run verify
```

Do not add model providers, brokerage/exchange account adapters, authenticated exchange access, wallets/signing code, Freqtrade implementation code, PredictionMarketBench/PolyBench ingestion, credentials, customer data, paid services, or strategy optimization without a separately accepted release gate. Release 0.2 permits only the bounded external Freqtrade public-data proof described in docs/RELEASE_0_2_PUBLIC_DATA_PROOF.md.

Contributions are submitted under Apache License 2.0 unless explicitly marked otherwise.
