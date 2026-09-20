# Repository instructions

This repository is the public research codebase for the Lowcountry Digital Works Agent Trading Lab.

Release 0.2 is limited to the deterministic Freqtrade + public-data measurement integration authorized by `LowcountryDigitalWorks/business-operations#247`, building on accepted Release 0.1 main `bd007bc8f88d25afe8eedf375824709e5d963e8e`.

## Boundaries

- Freqtrade `2026.8` remains an external GPLv3 CLI/file-artifact boundary; do not import, vendor, copy, or link its implementation into LDW-authored modules.
- Public Kraken historical data only for `BTC/USDT` and `ETH/USDT`, frozen 2026-08-01 through 2026-09-01 UTC, end exclusive.
- No live or paper brokerage/exchange connectivity or order submission.
- No account, API-key, wallet, signing, private-key, credential, or secret handling.
- No external model/API calls, prediction-market ingestion, or Phase 0B semantic treatment.
- No customer, PHI, CUI, payment, or account data.
- No hyperopt, return-seeking parameter search, or strategy optimization.
- No real-money path; real capital and incremental cash cost remain $0.

Use branches and pull requests for meaningful changes. Keep routine CI synthetic/offline, preserve Release 0.1 contract validators and append-only/hash-chained/tamper-evident evidence semantics, and return to the owning Product Orchestrator before any Release 0.3+ or model work.
