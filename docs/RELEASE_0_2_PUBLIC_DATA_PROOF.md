# Release 0.2 — Freqtrade + public-data measurement integration

Release 0.2 proves the Release 0.1 evidence contracts against one frozen public historical market-data source. It is a measurement/integration proof, not a trading-alpha claim.

## Frozen source

- Freqtrade release tag `2026.8`, upstream commit `9f10e357a93c1dcf10c2a2b367659214d89c073e`.
- Freqtrade remains an external GPLv3 CLI/file-artifact boundary. No Freqtrade implementation is copied, imported, vendored, or linked into LDW-authored modules.
- Docker release index digest: `sha256:4d23160b501d2b34579e76f57ad75edfa274967cd0dd824ff1c1b86d8c166ab4`.
- Kraken spot public historical trades only; no account, credentials, API key, or authenticated endpoint.
- Pairs: `BTC/USDT` and `ETH/USDT`.
- Window: `2026-08-01T00:00:00Z` through `2026-09-01T00:00:00Z`, end exclusive.
- Freqtrade acquisition uses `--dl-trades --convert --timeframes 5m 1h` with plain JSON at the LDW boundary.

The exact command/config is versioned in `proof/acquisition.json`.

## Deterministic normalization and quote volume

Freqtrade OHLCV JSON is treated as positional `[timestamp, open, high, low, close, volume]`. Trade JSON is treated as positional `[timestamp, id, type, side, price, amount, cost]`. Import fails closed on unexpected pairs/timeframes/window configuration, malformed rows, non-finite values, out-of-order records, duplicate candle timestamps, or duplicate trade IDs. Freqtrade/Kraken may return validated boundary over-fetch beyond the requested timerange; those ordered/validated rows are deterministically excluded from the frozen proof window and the raw range plus excluded-before/excluded-after counts are retained in data-quality diagnostics. Equal trade timestamps are permitted because distinct public trades may share a millisecond; they are counted diagnostically.

The liquidity gate does **not** approximate quote volume as base-volume × close. Five-minute quote volume is derived from the public trade artifact as `sum(price × amount)` for the execution bucket and is hashed as a derived artifact with the raw trade hash as its parent.

## Phase 0A control and execution

The control uses closed 1h candles only. EMA20 and EMA50 use no future candles. A bullish transition while flat requests BUY; a bearish transition while holding requests SELL; otherwise the action is HOLD. There is no pyramiding and at most one position per asset.

The decision timestamp is the 1h candle close. On the frozen aligned 5m grid, nominal execution requires exactly T+5m and stress requires exactly T+10m. If that exact required bucket is absent, execution fails closed to SKIP; a later available candle is never substituted. The 5m bar open is the historical reference price, avoiding invented intra-candle ordering.

Virtual risk is fixed at 10,000 starting units, 10% entry stake, 20% maximum aggregate exposure, a 2% UTC-day start-equity loss gate, and a 10% hard experiment drawdown gate. Loss/drawdown gates stop new entries while still allowing deterministic exits that reduce exposure.

Nominal per-side costs are 10 bps fee + 2 bps half-spread + 3 bps slippage. Stress uses 10 + 5 + 10 bps plus one extra 5m bar of latency. A separate same-reference monotonicity invariant proves the stress cost normalizer itself can never improve a fill.

## Evidence and proof operation

The implementation reuses CandidateEnvelope v1, DecisionRecord v1, GateResult v1, FillRecord v1, EvidenceEvent v1, and RunManifest v1. Each replay emits append-only, hash-chained, tamper-evident JSONL evidence and a canonical substantive digest under the Release 0.1 wall-clock normalization rule.

Routine CI uses only synthetic fixtures and never downloads market data. The one-time real-data proof is isolated in `.github/workflows/public-data-proof.yml` and runs only when a PR body contains `RUN_PUBLIC_DATA_PROOF=1` on an opened/edited PR event. Its artifact contains the sanitized proof summary, run manifest, and derived evidence ledgers; raw Kraken/Freqtrade data is not uploaded as proof evidence or committed to the repository.

The proof workflow checks out and records the exact pull-request head SHA rather than GitHub's synthetic merge ref. The proof reports adjusted net return, turnover, fill/trade count, execution-cost drag, maximum drawdown, average/maximum exposure, rejection counts, nominal-vs-stress results, input/candidate/fill/evidence counts, data quality, hashes, and canonical evidence digests. Positive P&L is not labeled evidence of alpha.
