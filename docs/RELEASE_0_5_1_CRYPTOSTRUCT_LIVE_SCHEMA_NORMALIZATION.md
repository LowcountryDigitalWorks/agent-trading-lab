# Release 0.5.1 — CryptoStruct live-schema normalization

Release 0.5.1 is the bounded correction authorized by `LowcountryDigitalWorks/business-operations#272`.

Release 0.5 remains historically complete with final source result **BLOCKED**. This correction does not rewrite that result. It aligns the provider-neutral adapter with the already captured sanitized Release 0.5 live-proof observations and the Product-frozen normalization contract.

## Stage 1 boundary

Stage 1 is code, documentation, synthetic fixtures, and offline deterministic CI only.

- Additional live CryptoStruct calls: **0**
- Direct Polymarket calls: **0**
- Direct Kalshi calls: **0**
- Model calls / OOS / trading / P&L: **0**
- Incremental cash: **$0**

A replacement live proof is not authorized by this release candidate.

## Observed MCP wire envelope

Synthetic fixtures reproduce the observed success envelope:

```text
{ jsonrpc, id, result }
result.content[] -> { type: "text", text: "<JSON payload>" }
```

The adapter no longer treats `structuredContent` as the Release 0.5.1 wire contract.

## Discovery and semantic authority

`search_instruments` is candidate discovery only. Query text, rank, and fuzzy code similarity are not category or semantic authority. `IndependentEventSpec.category` remains authoritative.

## Masterdata and provider semantics

Observed `instrument_id` is normalized to a stable string identity, `code` is frozen mapping evidence, and raw `type` becomes internal `instrument_class`. Eligible cutoff state is `open`.

The adapter does not require nonexistent raw orientation, price-semantics, provenance, provider-version, stable-id, or close-time fields. For CryptoStruct Polymarket `prediction` instruments, Product freezes provider-level semantics as `orientation=YES` and `price_semantics=probability_0_1`. Event-level equivalence still requires a VERIFIED SourceMappingRecord.

## SourceMappingRecord

A private `cryptostruct-source-mapping-record.v1` binds the IndependentEventSpec hash to one CryptoStruct instrument ID/code, venue/type, mapping-review timestamp, mapping-evidence hash, and `VERIFIED` status. Missing or changed mapping fails closed as `semantic_mapping_unproven`.

## Snapshot normalization

- `captured_at_utc = raw.as_of`
- `p_control = raw.price_last`
- `trades_60m = raw.last_60m.trades`
- `turnover_usd_60m = raw.last_60m.turnover_usd`
- `spread_bps_60m_avg = raw.last_60m.spread_bps_avg`
- `top1_depth_bid_usd_60m = raw.last_60m.top1_depth_usd.bid`
- `top1_depth_ask_usd_60m = raw.last_60m.top1_depth_usd.ask`
- `top1_depth_min_side_usd_60m = min(bid, ask)`

`change_24h_pct`, `vwap_last_minute`, and `last_24h` are observed diagnostic keys only: they may be absent, null, or provider-shaped differently without making an otherwise valid normalized snapshot ineligible. They are ignored by Release 0.5.1 normalization and eligibility. Unknown top-level provider fields still fail closed under the existing schema-change posture. Midpoint math, later observations, and historical nearest values are not p_control substitutes.

## Quality gate

Thresholds remain unchanged: trades >=5, turnover >=$100, average spread <=2,000 bps, and minimum-side top-1 depth >=$50. Minimum-side depth means both bid and ask sides independently meet the floor.

Eligibility also requires frozen IndependentEventSpec, VERIFIED SourceMappingRecord, stable ID/code, open Polymarket prediction state, exact cutoff timing, source-schema fingerprint, and Product-frozen source-contract hash.

## Provenance and evidence

Provider-version strings are not fabricated. Private evidence records the MCP endpoint, exact tool, instrument ID/code/venue, response hash where permitted, source-schema fingerprint, Product-frozen source-contract hash, SourceMappingRecord hash, timing, and explicit corrected 60m fields.

Public evidence remains aggregate and non-reconstructive and may expose only counts/categories/canonical rejection codes/schema and contract hashes/throughput/final classification.

## Statistical contract

The existing Phase 0B floors and scoring/robustness rules are unchanged.

## Validation

```sh
npm ci
npm run verify
```

CI is offline, synthetic, deterministic, and dependency-free.
