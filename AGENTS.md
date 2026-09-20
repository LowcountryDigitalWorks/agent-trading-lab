# Repository instructions

This repository is the public research codebase for the Lowcountry Digital Works Agent Trading Lab.

Release 0.1 is limited to the deterministic measurement-contract scaffold authorized by `LowcountryDigitalWorks/business-operations#246`.

## Boundaries

- No live or paper brokerage/exchange connectivity.
- No wallet, signing, private-key, credential, or secret handling.
- No external model/API calls.
- No Freqtrade implementation import, vendoring, or copied GPLv3 code.
- No PredictionMarketBench or PolyBench ingestion in Release 0.1.
- No customer, PHI, CUI, payment, or account data.
- No real-money path.
- Incremental cash cost must remain $0 unless separately authorized.

Use branches and pull requests for meaningful changes. Keep evidence deterministic, validate schemas, preserve the append-only/hash-chained/tamper-evident terminology, and return to the owning Product Orchestrator before beginning Release 0.2.
