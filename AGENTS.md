# Repository instructions

This repository is the public research codebase for the Lowcountry Digital Works Agent Trading Lab.

Release 0.3 is limited to the deterministic Phase 0A executability sensitivity authorized by `LowcountryDigitalWorks/business-operations#251`, building on accepted Release 0.2 main `ac3a316d07788ea90183f3acef61dcc70106682b`.

## Boundaries

- Run exactly two stake configurations for Release 0.3: canonical 10% control and predeclared 1% engineering sensitivity. The default remains 10%.
- Use exactly one shared Kraken public dataset for BTC/USDT and ETH/USDT from 2026-05-01 through 2026-08-01 UTC, end exclusive.
- Freqtrade `2026.8` remains an external GPLv3 CLI/file-artifact boundary; do not import, vendor, copy, or link its implementation into LDW-authored modules.
- Preserve Release 0.2 EMA, risk, liquidity, exact T+5m/T+10m execution, cost, fail-closed and evidence-contract behavior.
- The May-August window is engineering coverage data only, not strategy-edge or independent OOS evidence.
- No other stake, liquidity threshold, window, asset, EMA setting, strategy, cost/latency rule, partial fill, hyperopt, or return-seeking optimization is authorized.
- No Phase 0B, external model/API calls, prediction-market integration, live/paper brokerage/exchange connectivity, order submission, account/API-key/wallet/signing/credential handling, or real capital.
- No customer, PHI, CUI, payment, or account data.
- Incremental cash and real capital remain $0.

Use branches and pull requests for meaningful changes. Keep routine CI synthetic/offline, preserve Release 0.1 contract validators and append-only/hash-chained/tamper-evident evidence semantics, run exactly one controlled Release 0.3 public-data proof after the candidate is frozen, and return to Product Orchestrator before merge or any later release.
