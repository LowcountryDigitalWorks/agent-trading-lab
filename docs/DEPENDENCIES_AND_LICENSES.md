# Dependency and license boundary

## LDW-authored Release 0.1

License: Apache License 2.0.

Runtime dependencies: none.
Development dependencies: none.

Node.js standard-library modules are used for hashing, filesystem access, tests, and local validation scripts.

## Freqtrade

Freqtrade is GPLv3 and is **not** vendored, copied, imported, or linked as implementation code in Release 0.1. A later authorized release may interact with it only through an external CLI/file-artifact boundary unless a separate license review authorizes another design.

## PredictionMarketBench

Not required or incorporated in Release 0.1. If a later release incorporates MIT-licensed material, required notices must be preserved.

## PolyBench

Reference only for now. Do not copy, vendor, redistribute, or ingest its code/data until explicit reuse terms are established and separately reviewed.

## Release 0.2 external runtime boundary

Release 0.2 resolves Freqtrade tag `2026.8` (upstream commit `9f10e357a93c1dcf10c2a2b367659214d89c073e`) only as an external GPLv3 CLI/file-artifact producer. LDW code does not import, link, vendor, copy, or redistribute Freqtrade implementation code.

The repository still has zero npm runtime dependencies and zero npm development dependencies. The one-time public-data workflow pins the Freqtrade container by digest and uses only public Kraken historical data. Raw downloaded market data is not committed or uploaded as the retained proof artifact.

## Release 0.3

Release 0.3 adds no npm runtime or development dependencies. It reuses the pinned Freqtrade 2026.8 external GPLv3 CLI/file-artifact boundary and does not copy, import, vendor, link or redistribute Freqtrade implementation code.

The controlled proof acquires only public Kraken historical data and retains sanitized manifests, hashes, signal/scale diagnostics, metrics and evidence ledgers. Raw downloaded market data is not committed or retained in the proof artifact.

## Release 0.4

Release 0.4 adds no npm runtime or development dependencies. The Kalshi integration uses Node.js built-in `fetch` against official public unauthenticated REST market-data endpoints; no Kalshi SDK is added.

The repository retains source references, code, synthetic fixtures, hashes and sanitized aggregate qualification evidence only. Raw live Kalshi response bodies and bulk external market archives are not committed or retained in the public proof artifact.

Public endpoint access does not establish unrestricted redistribution rights. Exact normalized forward-snapshot retention/redistribution terms remain unresolved before model-scored OOS, so Release 0.4 does not claim that raw source data may be republished.

## Release 0.5 CryptoStruct

Release 0.5 adds no npm runtime or development dependencies. The provider boundary is implemented with injected tool functions and synthetic fixtures only; no CryptoStruct SDK, MCP SDK, database, authentication library, or network package is introduced.

Published source documentation reference: `https://cryptostruct.com/docs/mcp`.

CryptoStruct operational Data access is not part of this implementation candidate. Under the accepted Product/ORCH4 contract, the first real data-returning MCP/API call constitutes an owner legal/terms gate. Development therefore does not invoke CryptoStruct, create an account/OAuth grant, enable Premium, purchase data/realtime, or access direct Polymarket/Kalshi.

Public repository material is limited to code, schemas, synthetic fixtures, source/license references, hashes, aggregate/non-reconstructive evidence, and disposition. Raw CryptoStruct responses, per-market price datasets, full orderbooks, and reconstructive archives are prohibited.

