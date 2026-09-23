# Release 0.5 — CryptoStruct source adapter and evidence qualification

Release 0.5 implements only the **documentation + synthetic** replacement-source contract authorized by `LowcountryDigitalWorks/business-operations#269` and frozen by Product Orchestrator comment `#263 / 5789479942`.

Operational CryptoStruct Data access is **not authorized** by this release candidate. The current published CryptoStruct Data License must be explicitly accepted by the owner before any real data-returning MCP/API call is made.

## Purpose

The source contract asks one bounded question before any model-scored OOS work: can CryptoStruct keyless Free MCP/analytics, limited initially to Polymarket instruments, plausibly provide the timestamped probability baseline and source-quality evidence required by the existing Phase 0B forecast experiment?

Release 0.5 does not call a model, begin OOS-A/OOS-B, trade, calculate trading P&L, create an account, authenticate, purchase data, enable Premium, or query Polymarket/Kalshi directly.

## Published CryptoStruct MCP surface

Published documentation reviewed for this release:

- MCP endpoint: `https://cryptostruct.com/mcp`
- MCP documentation: `https://cryptostruct.com/docs/mcp`
- transport: Streamable HTTP, stateless
- free tier: keyless; OAuth is optional for account features
- anonymous free call budget is documented separately from Premium
- market turnover and depth are documented in USD
- prediction-market/event-contract prices are treated by the accepted Product contract as `0..1` Yes/Up probability values

Release 0.5 allows only these documented free tools:

- `search_instruments` — discovery only;
- `get_instrument` — master/provenance metadata;
- `get_market_snapshot` — live last price and current 60-minute activity/quality evidence.

The public CryptoStruct MCP documentation describes the semantics of these tools but does not freeze every field-level response name in the repository. Therefore the synthetic fixtures in this release define the **accepted normalized LDW adapter contract**, not a claim that live field names have already been qualified. A later owner-approved live qualification proof must verify the actual tool/schema/units. Any mismatch fails closed and returns to Product/ORCH4; thresholds must not be reinterpreted ad hoc.

## Provider-neutral adapter boundary

`src/cryptostruct-source.mjs` exposes provider-neutral operations:

- `searchInstruments()`
- `getInstrument()`
- `getMarketSnapshot()`

The CryptoStruct implementation is injected through an `invokeTool` function rather than embedding a network client or provider SDK. Operational calls are hard-gated by `operationalAccessAuthorized`; without separate owner authorization every tool method throws `OWNER_LICENSE_ACCEPTANCE_REQUIRED` before invoking the injected function.

Routine tests never enable operational access.

## Initial venue and universe

Provider:

`CryptoStruct`

Underlying initial venue:

`Polymarket only through CryptoStruct`

No direct Polymarket/Kalshi fallback exists.

Allowed Phase 0B categories:

- `WEATHER_CLIMATE`
- `MACROECONOMICS`
- `SCIENCE_TECHNOLOGY`
- `ENTERTAINMENT_CULTURE`

Explicitly excluded remain politics/elections/public office, sports/gaming/esports, war/terrorism/assassination, unlawful activity, short-horizon crypto/stock/FX/commodity direction, investment-return questions, subjective/self-resolving questions, and events without independent objective resolution.

## IndependentEventSpec

An `IndependentEventSpec` must exist before T-24h and is the semantic source for both treatment and resolution. It contains:

- canonical event ID;
- canonical question;
- frozen YES condition;
- frozen NO condition;
- allowed category;
- event deadline/close;
- independent official resolution authority;
- resolution reference;
- frozen criteria hash;
- exactly T-24h, T-6h, T-1h cutoffs.

If this cannot be created independently of CryptoStruct Data, the event is ineligible.

The treatment-context helper emits only independent fields plus the observation cutoff. It does not contain CryptoStruct/Polymarket identity, instrument IDs, price, crowd probability, trades, turnover, spread, depth, or other CryptoStruct-derived data.

## Binary orientation and p_control

An eligible source instrument must be:

- underlying venue `Polymarket`;
- binary prediction instrument;
- unambiguous `YES` or `UP` orientation;
- explicitly qualified as `probability_0_1` price semantics;
- backed by stable source/provenance identity.

For an eligible snapshot:

`p_control = get_market_snapshot.last_price`

`p_control` must be finite and in `[0,1]`.

Release 0.5 does **not** implement Kalshi midpoint/reciprocal-ask math, a synthetic ask, daily/hourly close substitution, VWAP substitution, later-observation substitution, or retrospective backfill.

## Cutoff timing

The frozen observation schedule remains:

- T-24h
- T-6h
- T-1h

For each future scored cutoff:

- request start must equal the scheduled cutoff;
- request completion must be no later than cutoff + 60 seconds;
- the normalized snapshot capture timestamp must lie inside that request interval.

Missing, malformed, late, stale, rate-limited, or otherwise failed primary observations are ineligible. No later request may replace the scored observation.

## Source-quality gate

Each cutoff is independently eligible only when all checks pass:

- event/instrument remains open and unresolved;
- frozen instrument has not changed;
- independent criteria hash has not changed;
- binary YES/Up orientation remains valid;
- snapshot identity matches the frozen instrument;
- cutoff timing is valid;
- `last_price` is finite and within `[0,1]`;
- rolling 60-minute trades >= 5;
- rolling 60-minute USD turnover >= 100;
- top-1 USD depth >= 50;
- spread is finite, non-negative, and <= 2,000 bps;
- required source/provenance fields remain present.

No threshold is tuned by Release 0.5.

## Deterministic selector

At T-24h, source-eligible instruments mapped to one IndependentEventSpec are sorted by:

1. highest 60-minute USD turnover;
2. highest 60-minute trade count;
3. lowest spread bps;
4. highest top-1 USD depth;
5. lexicographically smallest stable instrument ID.

The selected instrument is frozen. T-6h/T-1h do not switch to another instrument if the frozen instrument becomes ineligible.

Duplicate/correlation controls deterministically reject duplicate IndependentEventSpec hashes, shared real-world event clusters, and semantic aliases before cohort admission.

## Independent resolution

CryptoStruct/Polymarket price or implied market outcome is never authoritative settlement.

The resolution state starts `pending` and becomes either:

- `resolved` only from the predeclared official authority/reference with unambiguous YES/NO outcome plus retrieval timestamp and evidence hash; or
- `invalid` when unavailable, ambiguous, disputed, materially changed, authority-mismatched, or price-derived.

Invalid events are not scored.

## Evidence boundaries

### Private cutoff evidence

The private payload schema is `cryptostruct-private-evidence.v1`. It is carried inside the existing Release 0.1 `EvidenceEvent v1` envelope; the envelope supplies evidence sequence, previous-record hash, and record hash.

Private payload fields include the independent event/spec identity, CryptoStruct instrument ID, Polymarket orientation, source tool/version, timing, p_control, 60-minute activity/quality metrics, eligibility/rejection, optional response hash, frozen deadline, independent resolution evidence, treatment-context hash, and nullable future model/result accounting fields.

Full L2, raw MCP archives, unrelated fields, and reconstructive venue datasets are not retained by default.

### Public evidence

`cryptostruct-public-evidence.v1` is aggregate-only. It may contain provider/venue labels, aggregate sample and eligibility counts, rejection/category counts, source-contract hashes, and `QUALIFIED` / `INSUFFICIENT` / `BLOCKED` disposition.

Public evidence explicitly rejects per-market instrument IDs, prices/p_control, trades, turnover, spread, depth, raw responses, raw orderbooks, and reconstructive datasets.

## Free-tier fail-closed behavior

If CryptoStruct becomes unavailable, removes or changes the required MCP tools, removes required fields, rate-limits past the cutoff tolerance, requires authentication/Premium/purchase, or materially changes its license, the source pauses/fails closed.

No automatic action may create an account/OAuth, buy Premium/files, enable paid realtime, query direct Polymarket/Kalshi, change cutoffs, or lower source/statistical thresholds.

## Throughput estimator

Release 0.5 preserves the existing future cohort floors:

- max 150 selected events;
- target 120 valid resolved events;
- >=100 unique resolved events;
- >=300 paired eligible forecast decisions.

The deterministic estimator scales a bounded qualification sample to the 150-event cohort ceiling and returns only `PLAUSIBLE` or `DATA_INSUFFICIENT`. It does not alter floors or add categories/sources to manufacture feasibility.

## Owner license gate

CURRENT:
No Release 0.5 operational CryptoStruct Data access has occurred.

PROPOSED:
After a separate ORCH4 owner-approval record, one bounded keyless CryptoStruct/Polymarket qualification proof may be run under the then-current Data License boundary.

COST:
$0.

ROLLBACK:
Stop access and follow applicable deletion obligations; retain only permitted non-reconstructive derived evidence.

Until that gate exists, do not make even one real data-returning CryptoStruct MCP/API call.
