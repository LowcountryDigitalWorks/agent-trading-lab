# Release 0.4 — Phase 0B forecast harness and Kalshi source qualification

Release 0.4 implements only the Phase 0B forecast-measurement foundation and one bounded public-source qualification authorized by `LowcountryDigitalWorks/business-operations#258`.

It does **not** run a model-efficacy experiment, start OOS-A/OOS-B collection, trade, simulate P&L, create credentials, or spend money.

## Current source contract

The primary source candidate is Kalshi's public market-data REST API:

- production base: `https://external-api.kalshi.com/trade-api/v2`;
- public market-data quick start: `https://docs.kalshi.com/getting_started/quick_start_market_data`;
- orderbook response guide: `https://docs.kalshi.com/getting_started/orderbook_responses`;
- event source: `GET /events`;
- current market orderbook: `GET /markets/{ticker}/orderbook`.

The bounded adapter sends public `GET` requests only and deliberately sends no authorization, API-key, signing, account, or trading headers. The source-qualification workflow uses `depth=1` orderbook requests to minimize the live response surface while retaining the top-of-book bids needed by the baseline.

Specialized Kalshi market-data quick-start and orderbook documentation explicitly describe these market-data reads as accessible without authentication. If the live source returns an authentication error, the qualification proof records that fact rather than creating credentials or changing source.

## Baseline

Kalshi exposes YES and NO bid ladders. Release 0.4 derives:

`best_yes_bid = highest YES bid`

`best_no_bid = highest NO bid`

`best_yes_ask = 1 - best_no_bid`

`yes_spread = best_yes_ask - best_yes_bid`

`p_control = (best_yes_bid + best_yes_ask) / 2`

Fixed-point decimal strings are parsed into integer millionths before the reciprocal ask, spread, midpoint ranking, and selector comparisons. A separate ask is never invented.

A snapshot fails closed when required source state is missing or invalid, including a closed/paused/halted market, missing rules or settlement metadata, one empty bid side, crossed book, spread above 0.10, malformed response, request failure, or invalid scheduled-cutoff timing.

## One market per event

At the first planned T-24h point, otherwise eligible binary markets are ranked by:

1. narrowest valid YES spread;
2. larger combined top-of-book YES + NO bid size;
3. lexicographically smaller ticker.

The selected ticker, close timestamp, and rules/reference hash are frozen. Later close/rules changes invalidate the event. The selector never switches to a more convenient market after observing later conditions.

Planned observation cutoffs are exactly T-24h, T-6h, and T-1h.

Release 0.4 tests this schedule only. It does not begin forward OOS collection.

## Forecast contract

Release 0.4 reuses CandidateEnvelope v1 and DecisionRecord v1 for track `0B`.

The treatment surface is mock/synthetic only. The only valid structured output is:

```json
{"p_yes": 0.61}
```

with finite `0.01 <= p_yes <= 0.99`.

Future treatment statuses `invalid`, `timeout`, and `unavailable` remain in the paired scoring sample using `p_treatment = p_control`. They are not deleted from evaluation.

There are no external model calls in Release 0.4.

## Metrics and falsification

The deterministic harness implements:

- treatment and control Brier Score;
- paired Brier improvement;
- Brier Skill Score;
- log loss with reporting-only clipping to [0.01, 0.99];
- fixed-bin calibration/reliability;
- treatment failure rate;
- LOW / MID / HIGH p_control diagnostics;
- event-cluster bootstrap with production configuration of 10,000 resamples and a frozen seed;
- category diagnostics;
- event-level top-1/top-2/top-3 positive-contribution removal;
- deterministic probability-stability sampling/evaluation.

BSS >=0.02 is represented only as a future practical effect-size floor, not a power guarantee.

## Future cohort state machine

Release 0.4 implements the contract without starting collection.

Each OOS cohort has:

- maximum 150 selected events;
- target 120 valid resolved events;
- minimum 100 unique resolved events;
- minimum 300 paired eligible forecast decisions.

OOS-B is non-overlapping with OOS-A. Exactly one redesign may occur only after OOS-A treatment-quality failure. Data insufficiency is not redesign authority. Failure of an evaluable OOS-B transitions to the final-fail/shelve-ready state.

No historical or source-qualification observation can satisfy these future efficacy gates.

## Evidence

Release 0.4 continues the Release 0.1 evidence discipline:

- CandidateEnvelope v1;
- DecisionRecord v1;
- EvidenceEvent v1;
- RunManifest v1;
- canonical SHA-256 hashing;
- append-only, hash-chained, tamper-evident JSONL evidence.

This is not WORM storage and no cryptographic immutability claim is made.

## Live source-qualification proof

Exactly one bounded proof may be armed only after routine synthetic/offline CI passes:

- maximum 250 HTTP GET requests total;
- maximum 50 candidate events inspected;
- authentication: none;
- API key: none;
- model calls: zero;
- trading/orders: zero;
- incremental cash: $0;
- real capital: $0.

The initial source universe excludes election/candidate/party/ballot/public-office markets, sports/gaming, war, terrorism, assassination, unlawful-activity contracts, and categories requiring a separate legal/platform gate. The qualification code conservatively admits ordinary weather/climate, science, technology, economics, entertainment/culture categories only.

## Retention boundary

Raw live Kalshi response bodies and bulk orderbook/market archives are ephemeral and are not committed or included in the public proof artifact.

Permitted retained proof material is sanitized aggregate evidence:

- endpoint/version references;
- schema fingerprints;
- aggregate response-hash-set digest;
- request/event/market counts;
- latency and error summaries;
- field missingness;
- category counts;
- spread/eligibility aggregates;
- qualification classification;
- RunManifest and evidence-chain hashes.

Current public access does not, by itself, establish unrestricted redistribution rights. Exact normalized forward-snapshot retention/redistribution terms remain unresolved before model-scored OOS. Consequently Release 0.4 may report the public source as technically usable while the final qualification classification remains `BLOCKED` until that retention boundary is resolved.

Valid source-qualification classifications are:

- `QUALIFIED`;
- `INSUFFICIENT`;
- `BLOCKED`.

All are valid Release 0.4 outcomes. No alternate source or broadened universe is tried automatically.
