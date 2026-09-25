# Release 0.5.3B — Offline Final-Proof Design / Integration Review

Release 0.5.3B is authorized by
`LowcountryDigitalWorks/business-operations#281`, ORCH4 comment
`5835962405`.

It is an **offline final-proof design/integration stage**. It creates one
repository-owned, fully pre-source-freezable candidate for Product review. It
does not authorize or perform any CryptoStruct Data-returning call.

## Hard boundary

During Release 0.5.3B:

- CryptoStruct Data-returning calls: 0;
- direct Polymarket calls: 0;
- direct Kalshi calls: 0;
- live proof workflow dispatches: 0;
- model/OOS/trading calls: 0;
- incremental cash: $0;
- real capital: $0.

The final source workflow defined by this release is intentionally
`workflow_dispatch` only and must remain undispatched until a later,
separate Product/ORCH4 authorization.

## Accepted engineering screen

Screen:

`NON_INFERENTIAL_DETERMINISTIC_ENGINEERING_SCREEN`

Frozen maximum future calls:

- `search_instruments <= 8`;
- `get_instrument <= 40`;
- `get_market_snapshot <= 30`;
- total Data-returning attempts `<= 78`;
- per-event snapshots `<= 1`;
- retries = 0.

Positive screen:

- at least 30 unique VERIFIED independent events;
- exactly 30 evaluable snapshots;
- 30 quality PASS;
- 0 quality rejects;
- 0 source/parser/accounting/evidence-integrity failures;
- 0 retries.

Quality thresholds remain exactly:

- trades_60m >= 5;
- turnover_usd_60m >= 100;
- spread_bps_60m_avg <= 2000;
- top1_depth_min_side_usd_60m >= 50.

This remains a deterministic engineering screen. It does not establish
statistical representativeness, future provider-quality probability,
cross-event independence, T-24h/T-6h/T-1h stability, later category
robustness, or the later >=100-event / >=300-decision OOS floors.

---

## A. Independent event universe

Release 0.5.3B freezes **40 real IndependentEventSpec records** before any
hypothetical provider access.

The universe is deliberately generated from eight independently identified
NOAA/NCEI GHCN Daily Summaries stations across five local dates:

- 2026-09-28;
- 2026-09-29;
- 2026-09-30;
- 2026-10-01;
- 2026-10-02.

Each event asks whether NOAA/NCEI reports a daily maximum temperature
(`TMAX`) at or above a fixed Fahrenheit threshold for one station/date.

### Stations and thresholds

| City | NOAA/NCEI station | Threshold | Provider-neutral search term |
| --- | --- | ---: | --- |
| Atlanta | USW00013874 — Atlanta Hartsfield Jackson International Airport | 80°F | Atlanta daily high temperature |
| Boston | USW00014739 — Boston Logan International Airport | 68°F | Boston daily high temperature |
| Chicago | USW00094846 — Chicago O'Hare International Airport | 70°F | Chicago daily high temperature |
| Los Angeles | USW00023174 — Los Angeles International Airport | 75°F | Los Angeles daily high temperature |
| Miami | USW00012839 — Miami International Airport | 88°F | Miami daily high temperature |
| New York City | USW00094728 — NY City Central Park | 70°F | New York City daily high temperature |
| Phoenix | USW00023183 — Phoenix Airport | 100°F | Phoenix daily high temperature |
| Seattle | USW00024233 — Seattle Tacoma Airport | 65°F | Seattle daily high temperature |

These thresholds, dates, station IDs, questions, resolution criteria, query
terms, and aliases are repository-owned pre-source inputs. They were not
selected or amended using CryptoStruct, Polymarket, or Kalshi observations.

### Independent resolution source

Resolution authority:

`NOAA/NCEI GHCN Daily Summaries`

Each event points to the NOAA/NCEI Access Data Service for that station and
local date:

`https://www.ncei.noaa.gov/access/services/data/v1?dataset=daily-summaries&stations=<station>&startDate=<date>&endDate=<date>&format=json&units=standard&includeAttributes=false`

Station metadata references are also retained in the repository design:

- Atlanta:
  https://www.ncei.noaa.gov/cdo-web/datasets/GHCND/stations/GHCND%3AUSW00013874/detail
- Boston:
  https://www.ncei.noaa.gov/cdo-web/datasets/GHCND/stations/GHCND%3AUSW00014739/detail
- Chicago:
  https://www.ncei.noaa.gov/cdo-web/datasets/GHCND/stations/GHCND%3AUSW00094846/detail
- Los Angeles:
  https://www.ncei.noaa.gov/cdo-web/datasets/GHCND/stations/GHCND%3AUSW00023174/detail
- Miami:
  https://www.ncei.noaa.gov/cdo-web/datasets/GHCND/stations/GHCND%3AUSW00012839/detail
- New York City:
  https://www.ncei.noaa.gov/cdo-web/datasets/GHCND/stations/GHCND%3AUSW00094728/detail
- Phoenix:
  https://www.ncei.noaa.gov/cdo-web/datasets/GHCND/stations/GHCND%3AUSW00023183/detail
- Seattle:
  https://www.ncei.noaa.gov/cdo-web/datasets/GHCND/stations/GHCND%3AUSW00024233/detail

NOAA/NCEI GHCN Daily documentation:
https://www.ncei.noaa.gov/pub/data/cdo/documentation/GHCND_documentation.pdf

Provider availability is explicitly unknown. The offline universe demonstrates
only that 40 independently specified events can be represented before source
access. It does not assert that CryptoStruct or Polymarket contains any of
them.

Category counts:

- WEATHER_CLIMATE: 40;
- MACROECONOMICS: 0;
- SCIENCE_TECHNOLOGY: 0;
- ENTERTAINMENT_CULTURE: 0.

This engineering screen does not establish later category robustness.

---

## B. Provider-neutral query plan

The 40-event universe deterministically collapses to exactly eight unique
search queries:

1. Atlanta daily high temperature
2. Boston daily high temperature
3. Chicago daily high temperature
4. Los Angeles daily high temperature
5. Miami daily high temperature
6. New York City daily high temperature
7. Phoenix daily high temperature
8. Seattle daily high temperature

Each future search is frozen to:

- class = `prediction`;
- venue = `polymarket`;
- limit = 10;
- no retry.

Query order is deterministic after event-universe canonicalization.
Provider-returned hits are processed in returned order, with first occurrence
of an instrument ID retained.

Discovery attrition or semantic attrition cannot widen the eight-query plan.

---

## C. Semantic bundle

Every event receives deterministic aliases built only from:

- city;
- independent event date;
- independent temperature threshold;
- fixed repository-owned language templates.

Normalization remains the accepted exact deterministic 0.5.3A normalization:

- Unicode NFKC;
- lowercase;
- `&` -> `and`;
- non-letter/non-digit runs -> spaces;
- trim;
- collapse whitespace.

No fuzzy matching, embeddings, LLM judgment, probability/price use, or
post-source alias amendment is permitted.

Matching behavior:

- zero event matches -> `semantic_mapping_unproven`;
- multiple event matches -> `semantic_mapping_unproven`;
- exactly one valid match -> existing VERIFIED `SourceMappingRecord` path.

After a future `get_instrument`, the exact deterministic matcher runs again
before VERIFIED admission.

Category authority remains `IndependentEventSpec.category` only.

---

## D. Pre-source freeze surface

The candidate exposes canonical SHA-256 values for:

- source_contract_hash;
- event_universe_hash;
- query_plan_hash;
- semantic_bundle_hash;
- quality_screen_config_hash;
- diagnostic_contract_hash.

The freeze surface also contains:

- workflow identity;
- max search calls = 8;
- max get_instrument calls = 40;
- max snapshots = 30;
- max attempts = 78;
- max unique discovered candidates = 80;
- per-event snapshot cap = 1;
- retries = 0;
- per-call timeout = 10,000 ms;
- whole-proof timeout = 900,000 ms.

A future authority mismatch is rejected before runner creation and therefore
before `CALL_RESERVED`.

The exact candidate hashes are emitted by:

`npm run proof:release053:freeze`

and are to be frozen by Product/ORCH4 only after merge.

---

## E. Sanitized parser-diagnostic integration

The existing strict CryptoStruct tool parsers remain unchanged.

The deterministic proof runner now supports an optional
`onSourceContractParseError` hook. It is invoked only after:

1. valid HTTP success;
2. valid JSON-RPC envelope;
3. tool payload extraction into memory;
4. existing strict tool parser failure;
5. durable terminal `PARSE_ERROR / source_contract_parse_error`.

Release 0.5.3 uses the accepted 0.5.3A schema-only diagnostic generator at
that hook.

Retained file:

`sanitized-schema-diagnostics.jsonl`

Each record remains bounded, deterministic, and value-free. It may retain:

- proof_run_id and call_sequence;
- tool;
- source/parser hashes;
- source schema fingerprint;
- key-set hashes/counts;
- type/presence hash;
- known normalized failing paths;
- mismatch categories;
- diagnostic hash.

It does not retain:

- raw provider body;
- raw provider values;
- provider question/title;
- instrument ID/code;
- price/probability;
- order-book values;
- history;
- raw unexpected provider key names.

A diagnostic callback failure is itself evidence-integrity failure and leads to
BLOCKED classification.

---

## F. Deterministic orchestration

Future source execution, only if separately authorized later, remains inside
the accepted `DeterministicCryptoStructProofRunner`.

Preserved controls:

- durable `CALL_RESERVED` before dispatch;
- durable `CALL_DISPATCHED` before transport;
- monotonic call sequence;
- no sequence reuse;
- exactly one terminal state per reservation;
- no retry;
- per-call and whole-proof timeout;
- interruption reconciliation;
- bounded unique candidates;
- artifact finalization after failure;
- source calls serialized through the runner.

Release 0.5.3 adds a second layer of tool-specific ceilings:

- search <=8;
- get_instrument <=40;
- snapshot <=30;
- total <=78.

### Future execution order

1. validate exact authority/freeze surface before runner creation;
2. execute the eight frozen searches;
3. deterministic event-first candidate selection;
4. if fewer than 30 candidates can even be admitted from discovery:
   INSUFFICIENT;
5. validate candidates with `get_instrument` in deterministic order;
6. run exact semantic matcher again;
7. for each first unique VERIFIED event, take at most one snapshot;
8. any source/parser/accounting/integrity failure -> BLOCKED;
9. first quality reject -> immediate INSUFFICIENT;
10. 30 VERIFIED + 30 evaluable + 30 quality PASS -> TECHNICALLY_VIABLE;
11. deterministic exhaustion below that target -> INSUFFICIENT.

No later candidate is used to rescue a quality rejection.

---

## G. Classification

### BLOCKED

BLOCKED applies to:

- pre-dispatch identity/hash/config mismatch;
- source transport/access failure;
- strict parser/source-contract failure;
- attempt-accounting/budget violation;
- retry/non-frozen execution path;
- impossible aggregate evidence;
- diagnostic/evidence-integrity failure.

### INSUFFICIENT

INSUFFICIENT applies when execution is otherwise valid but:

- any frozen quality rejection occurs; or
- deterministic admission opportunity is exhausted without 30 unique
  VERIFIED events and exactly 30 evaluable snapshots.

### TECHNICALLY_VIABLE

TECHNICALLY_VIABLE requires:

- verified_unique_events >= 30;
- evaluable_snapshots = 30;
- quality_passes = 30;
- quality_rejects = 0;
- source failures = 0;
- parser failures = 0;
- accounting/evidence-integrity failures = 0;
- retries = 0.

It means only:

> 30 deterministically selected, independently specified event mappings each
> produced one parseable snapshot that passed every frozen source-quality
> threshold during the bounded qualification run.

It does not establish the later OOS claims described above.

---

## H. Artifact integrity

The historical deterministic call ledger remains:

`sanitized-call-ledger.jsonl`

Release 0.5.3 additionally retains:

- `sanitized-schema-diagnostics.jsonl`;
- `proof-summary.json`;
- historical control `proof-manifest.json`;
- historical control `artifact-hash.txt`;
- `release053-proof-manifest.json`;
- `release053-artifact-hash.txt`.

The release-specific manifest binds:

- source_contract_hash;
- event_universe_hash;
- query_plan_hash;
- semantic_bundle_hash;
- quality_screen_config_hash;
- diagnostic_contract_hash;
- SHA-256 of the historical control manifest;
- ledger_final_hash;
- proof_summary_hash;
- diagnostics_hash;
- final Release 0.5.3 classification.

Its `artifact_hash` is SHA-256 over that complete canonical material.

Finalization is idempotent: an existing Release 0.5.3 manifest is accepted only
when the current ledger/summary/diagnostic evidence recomputes to the same
integrity material.

No raw provider corpus is retained.

---

## I. Future workflow

Workflow:

`.github/workflows/release053-final-source-proof.yml`

Properties:

- `workflow_dispatch` only;
- no push trigger;
- no pull_request trigger;
- no schedule trigger;
- no workflow_run trigger;
- `contents: read`;
- checks out exact authorized commit;
- validates all frozen identity/hash/config inputs before proof execution;
- reconciles outstanding reservations;
- finalizes sanitized evidence;
- uploads sanitized artifacts before propagating execution failure.

The workflow is defined for Product review but must remain **undispatched** in
Release 0.5.3B.

---

## J. Offline disposition

The independent universe is internally capable, in principle, of supporting
the accepted 30-event engineering screen within:

- 8 frozen searches;
- at most 40 instrument validations;
- at most 30 snapshots;
- at most 78 attempts.

The 40-event / 8-query design gives ten independently predeclared events of
headroom over the 30-event target without using provider observations.

Actual CryptoStruct coverage, mapping yield, parser success, and source
quality remain unknown until a separately authorized proof.

Offline recommendation:

**PROCEED_TO_FINAL_LIVE_PROOF_REVIEW**

This is only a Product review recommendation. It does not authorize live
source execution.
