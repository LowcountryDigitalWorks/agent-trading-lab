# Release 0.5.3A — CryptoStruct Qualification Redesign Feasibility

Release 0.5.3A is an **offline-only** feasibility redesign authorized by
`LowcountryDigitalWorks/business-operations#281`, comment `5826110019`.

It does not authorize another CryptoStruct proof. It makes **zero**
CryptoStruct Data-returning calls and does not access Polymarket or Kalshi
directly.

## Fixed predecessor evidence

Release 0.5.2 closed with **BLOCKED — ACCEPTED**. The retained sanitized
artifact is fixed evidence and is not reinterpreted:

- 45 / 45 attempted calls;
- 50 unique discovered candidates;
- 5 / 5 `search_instruments` calls succeeded;
- 20 / 20 `get_instrument` calls succeeded;
- 6 / 20 `get_market_snapshot` calls succeeded;
- 14 / 20 `get_market_snapshot` calls ended `PARSE_ERROR`;
- all 14 parse failures were HTTP 200 with
  `source_contract_parse_error`;
- semantic VERIFIED = 0 / 20;
- semantic unproven = 20 / 20;
- quality PASS = 0 / 6 evaluable snapshots;
- all six evaluable snapshots failed trades and turnover;
- five failed top-1 minimum-side depth;
- one failed spread.

Nothing in Release 0.5.3A guesses the raw schema difference, lowers the
quality gate, or retrofits aliases from the live run.

The current public CryptoStruct MCP documentation still describes
`search_instruments` as catalog/discovery, `get_instrument` as master data,
and `get_market_snapshot` as exposing last price, 60-minute
turnover/trades, spread, and top-of-book depth. It does not publish the exact
JSON response shape needed to reconstruct the 14 observed parse failures.
See:

- https://cryptostruct.com/docs/mcp
- https://cryptostruct.com/license

The Data License explicitly distinguishes non-reconstructive derived
aggregates/statistics from raw Data. Release 0.5.3A therefore designs
schema-only diagnostics and retains no raw provider response.

---

## A. Parser diagnostic contract

### Objective

A future strict-parser failure should answer:

> Which contract dimension differed?

without retaining provider values or weakening the parser.

Release 0.5.3A adds:

- `src/release053a-qualification-design.mjs`
- `schemas/cryptostruct-schema-diagnostic.v1.schema.json`
- synthetic mismatch fixtures and tests.

Schema:

`cryptostruct-schema-diagnostic.v1`

### Correlation fields

A diagnostic may retain:

- `proof_run_id`;
- `call_sequence`;
- fixed terminal reason `source_contract_parse_error`;
- source tool name.

It does **not** retain instrument ID or provider code.

### Contract identity

A diagnostic retains:

- source-contract hash;
- parser-descriptor version;
- parser-contract hash;
- source-schema fingerprint;
- actual top-level key-set hash;
- type/presence-map hash.

The parser contract is a canonical descriptor of the already accepted strict
parser shape. Release 0.5.3A does not alter any Release 0.5.2 parser.

### Bounded mismatch classes

The diagnostic can identify:

- `MISSING_EXPECTED_FIELD`;
- `UNEXPECTED_EXTRA_FIELD`;
- `WRONG_JSON_TYPE`;
- `NESTED_SHAPE_MISMATCH`.

Retained paths are normalized schema paths only. Unexpected provider field
names are not retained. The bounded path list contains at most 8 entries.

Nested key-set evidence contains only:

- known container path;
- expected key-set hash;
- actual key-set hash;
- expected key count;
- actual key count.

At most 8 nested key-set records are retained.

### Value-free evidence

The diagnostic never retains:

- raw response body;
- raw provider values;
- market question text;
- provider code;
- instrument ID;
- price or probability;
- order-book values;
- history;
- raw unexpected key names.

The diagnostic itself has a canonical SHA-256 `diagnostic_hash`.

### Integration point for a future reviewed runner

Do **not** change the strict parser merely because it failed.

A future Product-accepted runner may integrate the diagnostic only after:

1. the MCP envelope is valid;
2. the JSON payload is already in memory;
3. the existing tool parser throws;
4. the terminal status is therefore already
   `source_contract_parse_error`.

At that point the runner may derive the sanitized diagnostic from the
in-memory parsed JSON, persist only the diagnostic, then discard the source
payload.

A future sanitized artifact could include a bounded
`sanitized-schema-diagnostics.jsonl` whose records correlate to the existing
call ledger by `proof_run_id + call_sequence`.

No live integration is implemented or authorized in Release 0.5.3A.

### Synthetic proof

Fixtures demonstrate separate deterministic diagnostics for:

- missing expected field;
- unexpected extra field;
- wrong JSON type;
- nested object shape mismatch.

Tests also inject distinctive source values and assert those values and
unexpected field names do not survive into diagnostics.

---

## B. Event-first semantic contract

### Problem corrected

Release 0.5.2 froze a narrow independent NYC-weather semantic bundle but
searched a broad weather/inflation/space/AI/movie universe. The resulting
0 / 20 exact mappings are therefore a proof-design mismatch, not a
provider-wide semantic failure.

Release 0.5.3A changes the *design order*:

1. define the `IndependentEventSpec` universe;
2. freeze provider-neutral search terms from those independent specs;
3. freeze provider-neutral semantic aliases from those independent specs;
4. freeze deterministic normalization;
5. freeze the query plan;
6. freeze candidate-selection rules;
7. freeze the semantic bundle and hashes;
8. only a later separately authorized proof may access the provider.

No provider ID, code, question, price, probability, or observed hit may amend
steps 1–7.

### Query-plan schema

Schema:

`cryptostruct-event-first-query-plan.v1`

Each plan event contains:

- complete validated `IndependentEventSpec`;
- its SHA-256 hash;
- one or more pre-source provider-neutral query terms;
- one or more pre-source provider-neutral semantic aliases.

The plan is sorted by `event_id` before hashing.

The derivation contract is:

`independent-spec-authored-before-provider-access`

Normalization version:

`release-0.5.3-exact-normalized-alias.v1`

Normalization remains deterministic:

- Unicode NFKC;
- lowercase;
- `&` to `and`;
- non-letter/non-digit runs to spaces;
- trim;
- collapse whitespace.

There is no fuzzy matching, embedding similarity, LLM judgment, price use,
probability use, or hindsight amendment.

### Search-plan contract

Frozen search defaults remain:

- class = `prediction`;
- venue = `polymarket`;
- limit = 10.

The event-first plan allows at most 8 unique search calls.

Duplicate normalized search terms are collapsed by their first occurrence
after deterministic event sorting.

Search order is therefore fixed before source access.

### Candidate selection

A future result set is processed only in:

1. frozen query order;
2. provider-returned hit order;
3. first occurrence of instrument ID.

A candidate must still be:

- venue `polymarket`;
- class `prediction`;
- state `open`.

The source candidate code is compared against the **already frozen**
semantic aliases.

- zero exact event matches -> `semantic_mapping_unproven`;
- multiple exact event matches -> `semantic_mapping_unproven`;
- exactly one event match -> eligible for `get_instrument` validation.

Only one candidate per independent event may proceed.

At most 40 `get_instrument` attempts are permitted by the design.

### VERIFIED mapping

After `get_instrument`, the same exact event-first matcher runs again.

Exactly one match may create the existing:

`cryptostruct-source-mapping-record.v1`

using the existing:

- `createSourceMappingRecord()`;
- `validateSourceMappingRecord()`;
- `validateSourceMappingForSpec()`.

Category authority remains **IndependentEventSpec only**.

Probability and price are not inputs to mapping.

Synthetic tests deliberately place a throwing `p_control` getter on the
instrument and still produce a VERIFIED mapping, proving semantic mapping does
not read probability.

### Separate hashes

The design exposes separate canonical hashes for:

- event-first query plan;
- event-first semantic bundle;
- source contract;
- later quality-feasibility configuration.

Provider results cannot mutate those hashes.

---

## C. Quality feasibility design

### Thresholds remain unchanged

Release 0.5.3A freezes the existing quality gate exactly:

- trades_60m >= 5;
- turnover_usd_60m >= 100;
- spread_bps_60m_avg <= 2000;
- top1_depth_min_side_usd_60m >= 50.

No threshold tuning occurs.

### Future maximum source-call budget

The proposed **maximum** future 0.5.3B proof budget remains:

- up to 8 `search_instruments` calls;
- up to 40 `get_instrument` calls;
- up to 30 `get_market_snapshot` calls;
- **78 total Data-returning calls maximum**.

No retry is allowed.

This is a design-review proposal only. No 0.5.3B authority exists.

### Deterministic sample rule

A future proof would:

1. execute only the frozen event-first search plan;
2. process candidates deterministically;
3. exact-match only against the pre-source semantic bundle;
4. validate at most one candidate per independent event;
5. take snapshots only for VERIFIED unique events;
6. use the first 30 VERIFIED unique events in deterministic order;
7. take at most one qualification snapshot per independent event;
8. stop immediately after the first quality rejection.

Unmapped and ambiguous candidates are semantic attrition, not quality
failures.

Parser failures are source-contract failures, not quality failures.

A quality rejection is terminal **INSUFFICIENT** evidence for this screen.
The runner must not consume later snapshot candidates in an attempt to restore
a 30 / 30 result.

### Minimum evaluable sample

Positive technical viability requires:

**exactly 30 evaluable snapshots from at least 30 unique VERIFIED independent
events, with 30 / 30 passing the frozen quality gate.**

This is a source-qualification engineering screen, not the later OOS cohort.

### Why 30 — non-inferential deterministic engineering screen

The 30-event screen is explicitly:

**NON-INFERENTIAL DETERMINISTIC ENGINEERING SCREEN**

It is not a statistically representative sample and makes no confidence,
power, or future pass-probability claim.

Thirty remains a pragmatic bounded engineering screen because:

- Release 0.5.2 produced only six evaluable quality snapshots;
- 30 unique independently specified events provide materially broader
  engineering evidence than those six observations;
- the entire source-qualification attempt remains bounded at no more than 78
  Data-returning calls;
- 30 / 30 is deliberately strict before spending on a much larger forward
  cohort;
- one snapshot per event keeps this screen bounded and prevents it from being
  confused with the later three-cutoff experiment.

A **TECHNICALLY_VIABLE** result may mean only:

> 30 deterministically selected, independently specified event mappings each
> produced one parseable snapshot that passed every frozen source-quality
> threshold during the bounded qualification run.

It does **not** establish or estimate:

- statistical representativeness;
- a future source-quality pass probability;
- independence across events;
- independence across future cutoffs;
- T-24h / T-6h / T-1h temporal stability;
- later category robustness;
- satisfaction of the later >=100-event / >=300-decision cohort floors.

No binomial confidence bound or multi-cutoff probability calculation is part
of the acceptance rule.

### Observation-accounting invariants

Before future classification, aggregate evidence must be internally
consistent.

Required:

`quality_passes + quality_rejects === evaluable_snapshots`

`evaluable_snapshots <= verified_unique_events`

`evaluable_snapshots <= 30`

An impossible aggregate state is invalid evidence and must fail closed rather
than being silently classified.

### Future BLOCKED rule

Return **BLOCKED** immediately after the current terminal call if any of the
following occurs:

- pre-dispatch identity/config/hash mismatch;
- transport/access/tool/rate/auth/payment/source failure;
- strict parser/source-contract failure;
- attempt-accounting or call-budget failure;
- any retry or non-frozen execution path.

A parser failure should emit the new sanitized schema diagnostic, then stop.
It must not be fixed and retried under the same authority.

### Future INSUFFICIENT rule

After BLOCKED checks, return **INSUFFICIENT immediately** if:

- `quality_rejects > 0`, even when more deterministic candidates remain; or
- the frozen deterministic plan is exhausted before 30 unique VERIFIED events
  are available; or
- the plan ends with fewer than 30 evaluable snapshots without a BLOCKED
  condition.

The first quality rejection makes the predeclared 30 / 30 positive criterion
impossible.

No additional snapshot candidate may be selected or dispatched after that
rejection.

### Future technically-viable rule

Return **TECHNICALLY_VIABLE** only if all are true:

- at least 30 unique events have VERIFIED source mappings;
- evaluable snapshots = exactly 30;
- quality passes = exactly 30;
- quality rejects = 0;
- source failures = 0;
- parser failures = 0;
- accounting failures = 0;
- retries = 0.

This outcome would mean only that the bounded engineering screen passed.

It would not authorize model scoring, OOS-A/OOS-B, trading, or customer use.

### Category / cutoff robustness remains unestablished

This 30-event one-snapshot-per-event screen does **not** establish later
category robustness or three-cutoff stability.

The frozen Phase 0B OOS-B requirement remains at least three eligible
categories with >=20 resolved events each.

A later Product/ORCH4 design freeze could separately define the independent
event-universe/category composition before provider access. Provider-observed
category tuning remains prohibited.

No Release 0.5.3B engineering-screen result may be described as satisfying
that later OOS-B category requirement or the T-24h / T-6h / T-1h temporal
requirement.

---

## D. Offline decision memo

### Stop-condition review

The offline work does **not** hit the scientific stop conditions:

- useful parser diagnostics can remain deterministic and
  non-reconstructive;
- event-first semantics can be frozen without provider identifiers;
- sample selection can be predeclared without post-hoc liquidity tuning;
- a useful future conclusion can be declared before source access;
- another bounded proof could materially reduce the three remaining
  uncertainties independently;
- no paid service or dependency is required.

### Recommendation

**PROCEED_TO_0.5.3B_DESIGN_REVIEW**

This recommendation does **not** authorize any live CryptoStruct call.

Product must independently review the contracts, thresholds, sample rationale,
and stop rules. Only after Product acceptance could ORCH4 consider a fresh
one-proof authority with current legal revalidation.

## Security, privacy, cost, and data impact

Release 0.5.3A:

- CryptoStruct Data-returning calls: 0;
- direct Polymarket/Kalshi calls: 0;
- raw source corpus retained: 0;
- customer data / PHI / CUI / payment data: 0;
- model/OOS/trading calls: 0;
- runtime dependencies added: 0;
- development dependencies added: 0;
- incremental cash: $0;
- real capital: $0.
