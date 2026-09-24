# Release 0.5.2 — Deterministic CryptoStruct Proof Runner

Release 0.5.2 is the proof-control hardening release authorized by
`LowcountryDigitalWorks/business-operations#275`.

Release 0.5.1 remains historically complete with final result **BLOCKED** due
to an operational proof-control / evidence-integrity failure. CryptoStruct was
not rejected, and the merged Release 0.5.1 normalization was not disproven.

## Stage 1 boundary

Stage 1 is code, synthetic fixtures/tests, and offline CI only.

- Live CryptoStruct calls: **0**
- Browser source proof: **0**
- Direct Polymarket/Kalshi calls: **0**
- Model/OOS/trading/P&L: **0**
- Incremental cash: **$0**

A future live proof requires separate ORCH4 authority.

## Attempt-based authority

The future proof budget counts **Data-returning call attempts**, not successful
responses.

Before any future source dispatch, the runner:

1. assigns the next monotonic `call_sequence`;
2. appends and fsyncs `CALL_RESERVED`;
3. consumes one attempted-call slot;
4. verifies frozen call/candidate budgets;
5. appends and fsyncs `CALL_DISPATCHED`;
6. only then invokes the injected/native-fetch transport.

A reserved call is consumed even if transport, parsing, the process, or the
executor later fails.

## Internal single-flight execution

`executeCall()` owns a dependency-free Promise queue. The complete source-call
lifecycle is serialized inside the runner:

budget/candidate checks → durable reservation → durable dispatch → transport →
terminal persistence.

Caller concurrency such as `Promise.all()` is therefore safe: a second call
cannot inspect budget or candidate state until the prior call has reached its
terminal record (or rejected before reservation).

## JSON-RPC request/response correlation

For every HTTP-success JSON body, the runner requires both:

- `jsonrpc === "2.0"`
- returned `id === reserved numeric call_sequence` exactly

This check occurs before normal MCP result parsing and before MCP error
classification. A mismatched/string/missing ID or invalid JSON-RPC version
fails closed as `PARSE_ERROR / jsonrpc_protocol_mismatch`, registers no
candidate hashes, and records no source-schema fingerprint from that payload.

## Terminal states

Every reservation is finalized exactly once as one of:

- `SUCCESS`
- `HTTP_ERROR`
- `MCP_ERROR`
- `TIMEOUT`
- `PARSE_ERROR`
- `RUNNER_ABORTED_AFTER_RESERVATION`

Recovery never redispatches an unresolved reservation. It appends
`RUNNER_ABORTED_AFTER_RESERVATION` and preserves the consumed sequence.

## Durable call ledger

`sanitized-call-ledger.jsonl` is append-only and hash-chained. Each record
contains the proof/run ID, record and call sequences, tool, sanitized argument
hash, instrument ID where applicable, reservation/dispatch/completion
timestamps where reached, terminal state, HTTP status when applicable,
response/content hash when available, schema fingerprint when available, and
previous/current record hashes.

Every append is validated against the full prospective ledger and fsync'd
before the in-memory state advances.

Search-success records retain only SHA-256 hashes of discovered candidate IDs
for durable unique-candidate accounting; they do not retain a reconstructive
provider response corpus.

## Hard budgets

The frozen proof config contains:

- `max_attempted_calls`
- `max_unique_candidates`
- `per_call_timeout_ms`
- `whole_proof_timeout_ms`
- discovery-plan hash
- selector-config hash

A call cannot reserve after the attempted-call ceiling. Search limits cannot
exceed remaining candidate capacity. Follow-on `get_instrument` and
`get_market_snapshot` calls must reference already-discovered candidate IDs.

Duplicate candidate IDs do not consume additional unique-candidate capacity.

## Timeouts

The runner uses native Node `AbortController` and timers.

Each call has a per-call timeout, while the persisted proof start time anchors
a whole-proof timeout that survives runner resume. The effective call timeout
is the earlier of the per-call or remaining proof-wide deadline.

The intended future executor timeout must remain longer than the internal proof
timeout so reconciliation, manifest creation, hashing, and artifact upload have
time to complete.

## Manifest

The sanitized `cryptostruct-proof-manifest.v1` records:

- proof_run_id
- source_contract_hash
- exact checked-out runner commit/version
- started_at / ended_at
- frozen call/candidate/time budgets
- discovery-plan hash
- selector-config hash
- total reserved attempts
- terminal-state counts
- unique candidate count
- classification
- final ledger hash
- artifact hash

The artifact hash covers the finalized manifest material plus the ordered call
record hashes.

## Artifact survival

The Stage 1 synthetic workflow deliberately separates:

1. runner execution;
2. an `if: always()` reconciliation/finalization step;
3. an `if: always()` upload step;
4. propagation of runner failure only after preservation.

The uploaded artifact contains only:

- sanitized call ledger;
- manifest;
- artifact hash.

No raw provider-response corpus, reconstructive market dataset, full orderbook,
or bulk history is retained.

## Source/statistical contract

Release 0.5.2 does not change Release 0.5.1 source semantics.

Provider:

- CryptoStruct keyless MCP

Underlying venue:

- Polymarket only through CryptoStruct

Allowed future Data-returning tools:

- `search_instruments`
- `get_instrument`
- `get_market_snapshot`

Unchanged:

- `p_control = price_last`
- trades_60m >= 5
- turnover_usd_60m >= 100
- spread_bps_60m_avg <= 2000
- top1_depth_min_side_usd_60m >= 50
- IndependentEventSpec authority
- VERIFIED SourceMappingRecord
- source-separated treatment
- cohort/statistical floors
- no model/OOS/trading

## Future proof design only

No live proof is authorized by this release.

The runner is designed for a future separately frozen plan of at most five
discovery attempts followed by deterministic `get_instrument` /
`get_market_snapshot` pairs on already-discovered IDs, with no optional
diagnostic tools unless explicitly added by Product/ORCH4 before that run.

## Validation

```sh
npm ci
npm run verify
npm run proof:synthetic
```

Runtime and development package dependencies remain zero.

## Stage 2A deterministic live-proof entrypoint

Stage 2A adds the repository-owned operational entrypoint required for a later
separately authorized deterministic live proof. Stage 2A itself remains
**offline implementation only** and makes zero CryptoStruct Data-returning
calls.

The code-owned Stage 2 plan freezes:

- 45 maximum attempted calls;
- 50 maximum unique candidates;
- 10,000 ms per-call timeout;
- 480,000 ms whole-proof timeout;
- five discovery queries in exact order: weather, inflation, space, AI, movie;
- Polymarket / prediction / open filtering;
- first-occurrence deduplication by instrument ID;
- at most 20 deterministic deep-probe candidates;
- serial `get_instrument` followed by `get_market_snapshot` only for
  still-open Polymarket prediction instruments;
- no retry and no replacement candidate after failure.

The manual workflow is `.github/workflows/release052-live-proof.yml`. It uses
`workflow_dispatch` only, `contents: read`, Node 22, and a 15-minute job
timeout. It checks out the exact ORCH4-authorized commit and requires the
operator-supplied proof identity, source/discovery/selector hashes, call and
candidate ceilings, and internal timeout values to match the code-owned frozen
material before the runner can create its first reservation.

An arbitrary workflow-dispatch input is not authority. After Stage 2A is
independently reviewed and merged, ORCH4 must revalidate current CryptoStruct
terms, recompute the exact hashes, freeze the exact merged commit/tree and
proof run ID, and issue a new one-proof authorization before the workflow may
be dispatched.

The workflow preserves the accepted failure-survival ordering: execute with
`continue-on-error`, reconcile on `always()`, finalize on `always()`,
upload only the sanitized ledger/manifest/artifact hash, then propagate
execution failure. It introduces no browser path, direct Polymarket/Kalshi
path, model, OOS, trading, database, paid service, runtime dependency, or
development dependency.
