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
