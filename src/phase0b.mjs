import { canonicalSerialize, sha256Hex } from "./canonical.mjs";
import { validateCandidateEnvelope, validateDecisionRecord } from "./contracts.mjs";
import { buildEvidenceRecord, canonicalLedgerDigest, validateLedgerRecords } from "./ledger.mjs";

export const KALSHI_API_BASE = "https://external-api.kalshi.com/trade-api/v2";
export const PHASE0B_SOURCE_VERSION = "kalshi-trade-api-v2";
export const PHASE0B_EXPERIMENT_ID = "phase0b-forward-forecast-quality";
export const BOOTSTRAP_RESAMPLES = 10_000;
export const BOOTSTRAP_SEED = 0x4c445730;
export const OOS_MAX_SELECTED_EVENTS = 150;
export const OOS_TARGET_VALID_RESOLVED_EVENTS = 120;
export const OOS_MIN_RESOLVED_EVENTS = 100;
export const OOS_MIN_PAIRED_DECISIONS = 300;
export const CATEGORY_MIN_RESOLVED_EVENTS = 20;
export const REQUIRED_ADEQUATE_CATEGORIES = 3;
export const REGIME_MIN_PAIRED_DECISIONS = 50;

const SCALE = 1_000_000n;
const SPREAD_LIMIT = 100_000n;
const HOUR_MS = 3_600_000;
const SCHEDULE_HOURS = [24, 6, 1];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function plain(value, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value;
}
function iso(value, label) {
  assert(typeof value === "string" && value.endsWith("Z") && !Number.isNaN(Date.parse(value)), `${label} must be ISO UTC`);
  return value;
}
function prob(value, label) {
  assert(typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1, `${label} must be in [0,1]`);
  return value;
}
function fixed(value, label) {
  assert(typeof value === "string" && /^\d+(?:\.\d{1,6})?$/u.test(value), `${label} must be a fixed-point decimal string`);
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, "0"));
}
function numberFrom(units) {
  return Number(units) / Number(SCALE);
}
function top(levels, side) {
  assert(Array.isArray(levels) && levels.length > 0, `${side} side missing or empty`);
  let price = null;
  let size = 0n;
  for (const [index, level] of levels.entries()) {
    assert(Array.isArray(level) && level.length === 2, `${side} level ${index} malformed`);
    const p = fixed(level[0], `${side} price`);
    const q = fixed(level[1], `${side} size`);
    assert(p >= 0n && p <= SCALE && q > 0n, `${side} level invalid`);
    if (price === null || p > price) {
      price = p;
      size = q;
    } else if (p === price) {
      size += q;
    }
  }
  return { price, size };
}

export function deriveKalshiBaseline(response) {
  const book = plain(plain(response, "orderbook response").orderbook_fp, "orderbook_fp");
  const yes = top(book.yes_dollars, "YES");
  const no = top(book.no_dollars, "NO");
  const yesAsk = SCALE - no.price;
  assert(yesAsk >= 0n && yesAsk <= SCALE, "invalid implied YES ask");
  const spread = yesAsk - yes.price;
  const common = {
    best_yes_bid: numberFrom(yes.price),
    best_no_bid: numberFrom(no.price),
    best_yes_ask: numberFrom(yesAsk),
    yes_spread: numberFrom(spread),
    combined_top_bid_size: numberFrom(yes.size + no.size),
    p_control: numberFrom(yes.price + yesAsk) / 2,
    _spread_units: spread,
    _size_units: yes.size + no.size,
  };
  if (spread < 0n) return { ...common, eligible: false, reason: "crossed_book", p_control: null };
  if (spread > SPREAD_LIMIT) return { ...common, eligible: false, reason: "wide_spread" };
  return { ...common, eligible: true, reason: "eligible" };
}

function hasRules(market) {
  return typeof market?.rules_primary === "string" && market.rules_primary.trim().length > 0;
}
function hasResolution(event) {
  return Array.isArray(event?.settlement_sources)
    && event.settlement_sources.some((x) => x && typeof x.name === "string" && x.name.trim().length > 0);
}

export function evaluateSourceEligibility({
  event,
  market,
  orderbook,
  cutoff_utc = null,
  request_start_utc = null,
  request_complete_utc = null,
  enforce_cutoff = true,
}) {
  try {
    plain(event, "event");
    plain(market, "market");
    if (market.market_type !== undefined && market.market_type !== "binary") return { eligible: false, reason: "not_binary", baseline: null };
    if (market.status !== "open") return { eligible: false, reason: "market_not_open", baseline: null };
    if (market.paused === true || market.halted === true) return { eligible: false, reason: "market_paused_or_halted", baseline: null };
    if (!hasRules(market)) return { eligible: false, reason: "rules_unavailable", baseline: null };
    if (!hasResolution(event)) return { eligible: false, reason: "resolution_metadata_unavailable", baseline: null };
    if (enforce_cutoff) {
      iso(cutoff_utc, "cutoff");
      iso(request_start_utc, "request start");
      iso(request_complete_utc, "request complete");
      const cutoff = Date.parse(cutoff_utc);
      const start = Date.parse(request_start_utc);
      const end = Date.parse(request_complete_utc);
      if (start !== cutoff) return { eligible: false, reason: "request_not_started_at_cutoff", baseline: null };
      if (end < start || end > cutoff + 60_000) return { eligible: false, reason: "stale_or_invalid_response_timing", baseline: null };
    }
    const baseline = deriveKalshiBaseline(orderbook);
    return baseline.eligible
      ? { eligible: true, reason: "eligible", baseline }
      : { eligible: false, reason: baseline.reason, baseline };
  } catch (error) {
    return { eligible: false, reason: "malformed_source", baseline: null, detail: error.message };
  }
}

export function marketRulesHash(market, event) {
  return sha256Hex(canonicalSerialize({
    rules_primary: market?.rules_primary ?? null,
    rules_secondary: market?.rules_secondary ?? null,
    settlement_sources: event?.settlement_sources ?? null,
  }));
}

export function selectEventMarket(candidates) {
  assert(Array.isArray(candidates), "candidates must be an array");
  const eligible = candidates.filter((x) => x?.eligibility?.eligible === true);
  assert(eligible.length > 0, "no eligible binary market");
  eligible.sort((a, b) => {
    const ds = a.eligibility.baseline._spread_units - b.eligibility.baseline._spread_units;
    if (ds !== 0n) return ds < 0n ? -1 : 1;
    const dq = a.eligibility.baseline._size_units - b.eligibility.baseline._size_units;
    if (dq !== 0n) return dq > 0n ? -1 : 1;
    return String(a.market.ticker).localeCompare(String(b.market.ticker));
  });
  const chosen = eligible[0];
  return {
    event_id: String(chosen.event.event_ticker),
    selected_ticker: String(chosen.market.ticker),
    frozen_close_time_utc: iso(chosen.market.close_time, "close_time"),
    frozen_rules_hash: marketRulesHash(chosen.market, chosen.event),
    spread: chosen.eligibility.baseline.yes_spread,
    combined_top_bid_size: chosen.eligibility.baseline.combined_top_bid_size,
    p_control: chosen.eligibility.baseline.p_control,
  };
}

export function validateFrozenMarket(selection, { event, market }) {
  if (market.ticker !== selection.selected_ticker) return { valid: false, reason: "selected_ticker_changed" };
  if (market.close_time !== selection.frozen_close_time_utc) return { valid: false, reason: "close_time_changed" };
  if (marketRulesHash(market, event) !== selection.frozen_rules_hash) return { valid: false, reason: "resolution_criteria_changed" };
  return { valid: true, reason: "frozen_selection_valid" };
}

export function plannedObservationCutoffs(closeTimeUtc) {
  iso(closeTimeUtc, "closeTimeUtc");
  const close = Date.parse(closeTimeUtc);
  return SCHEDULE_HOURS.map((hours) => ({
    label: `T-${hours}h`,
    hours_before_close: hours,
    cutoff_utc: new Date(close - hours * HOUR_MS).toISOString(),
  }));
}

export function createForecastCandidate({
  event,
  market,
  selection,
  eligibility,
  cutoff_utc,
  request_start_utc,
  request_complete_utc,
  category,
}) {
  assert(eligibility?.eligible === true, "eligible source required");
  const state = {
    planned_cutoff_utc: cutoff_utc,
    request_start_utc,
    request_complete_utc,
    selected_ticker: selection.selected_ticker,
    frozen_close_time_utc: selection.frozen_close_time_utc,
    frozen_rules_hash: selection.frozen_rules_hash,
    best_yes_bid: eligibility.baseline.best_yes_bid,
    best_no_bid: eligibility.baseline.best_no_bid,
    best_yes_ask: eligibility.baseline.best_yes_ask,
    yes_spread: eligibility.baseline.yes_spread,
    p_control: eligibility.baseline.p_control,
    category,
  };
  const candidate = {
    schema_version: "candidate-envelope.v1",
    experiment_id: PHASE0B_EXPERIMENT_ID,
    track: "0B",
    candidate_id: `${event.event_ticker}:${selection.selected_ticker}:${cutoff_utc}`,
    event_time_utc: selection.frozen_close_time_utc,
    decision_time_utc: cutoff_utc,
    observation_cutoff_utc: cutoff_utc,
    source_id: "kalshi-public-rest",
    source_version: PHASE0B_SOURCE_VERSION,
    venue: "kalshi",
    instrument_id: selection.selected_ticker,
    instrument_type: "binary-forecast",
    state_hash: sha256Hex(canonicalSerialize(state)),
    features: [
      { name: "p_control", value: state.p_control, available_at_utc: cutoff_utc },
      { name: "category", value: category, available_at_utc: cutoff_utc },
    ],
    market_state: state,
    context_refs: [
      { ref_id: `${KALSHI_API_BASE}/markets/${encodeURIComponent(selection.selected_ticker)}/orderbook`, available_at_utc: cutoff_utc },
    ],
  };
  return validateCandidateEnvelope(candidate);
}

export function parseMockTreatment({ candidate_id, input_hash, output = null, status = "ok", latency_ms = 0 }) {
  let finalStatus = status;
  let pYes = null;
  if (status === "ok") {
    try {
      const value = typeof output === "string" ? JSON.parse(output) : output;
      assert(value && Object.keys(value).length === 1 && typeof value.p_yes === "number" && Number.isFinite(value.p_yes), "invalid treatment schema");
      assert(value.p_yes >= 0.01 && value.p_yes <= 0.99, "treatment probability out of range");
      pYes = value.p_yes;
    } catch {
      finalStatus = "invalid";
    }
  }
  assert(["ok", "invalid", "timeout", "unavailable"].includes(finalStatus), "invalid treatment status");
  const normalized = { p_yes: pYes, status: finalStatus };
  const record = {
    candidate_id,
    adapter_id: "phase0b-mock-treatment",
    adapter_version: "0.4.0",
    action: finalStatus === "ok" ? "HOLD" : "SKIP",
    instrument_side: null,
    p_yes: pYes,
    status: finalStatus,
    model_id: null,
    model_version: null,
    prompt_version: null,
    schema_version: "decision-record.v1",
    input_hash,
    output_hash: sha256Hex(canonicalSerialize(normalized)),
    latency_ms,
    input_tokens: null,
    output_tokens: null,
    incremental_cost_usd: 0,
  };
  return validateDecisionRecord(record);
}

export function treatmentProbabilityForScoring(decision, pControl) {
  prob(pControl, "p_control");
  return decision.status === "ok" ? prob(decision.p_yes, "p_treatment") : pControl;
}

export function probabilityBand(pControl) {
  prob(pControl, "p_control");
  if (pControl < 0.25) return "LOW";
  if (pControl <= 0.75) return "MID";
  return "HIGH";
}
export function brierLoss(p, y) {
  prob(p, "probability");
  assert(y === 0 || y === 1, "outcome must be 0 or 1");
  return (p - y) ** 2;
}
function clipped(p) { return Math.min(0.99, Math.max(0.01, p)); }
export function logLoss(p, y) {
  const q = clipped(prob(p, "probability"));
  assert(y === 0 || y === 1, "outcome must be 0 or 1");
  return -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
}

function scoreRows(rows) {
  assert(Array.isArray(rows) && rows.length > 0, "scored observations required");
  let c = 0, t = 0, improvement = 0, failures = 0, controlLog = 0, treatmentLog = 0;
  const events = new Set();
  for (const row of rows) {
    const pc = prob(row.p_control, "p_control");
    const pt = prob(row.p_treatment, "p_treatment");
    const y = row.outcome;
    const cb = brierLoss(pc, y), tb = brierLoss(pt, y);
    c += cb; t += tb; improvement += cb - tb;
    controlLog += logLoss(pc, y); treatmentLog += logLoss(pt, y);
    if (row.treatment_status && row.treatment_status !== "ok") failures += 1;
    events.add(row.event_id);
  }
  const control = c / rows.length, treatment = t / rows.length;
  return {
    paired_decisions: rows.length,
    unique_events: events.size,
    control_brier: control,
    treatment_brier: treatment,
    paired_brier_improvement: improvement / rows.length,
    brier_skill_score: control > 0 ? 1 - treatment / control : null,
    control_log_loss: controlLog / rows.length,
    treatment_log_loss: treatmentLog / rows.length,
    treatment_failure_rate: failures / rows.length,
  };
}
export function forecastMetrics(rows) { return scoreRows(rows); }

export function calibrationReliability(rows, { bins = 10, field = "p_treatment" } = {}) {
  assert(Number.isInteger(bins) && bins > 0, "bins must be positive integer");
  const buckets = Array.from({ length: bins }, (_, i) => ({ bin: i, count: 0, probability_sum: 0, outcome_sum: 0 }));
  for (const row of rows) {
    const p = prob(row[field], field);
    const index = Math.min(bins - 1, Math.floor(p * bins));
    buckets[index].count += 1;
    buckets[index].probability_sum += p;
    buckets[index].outcome_sum += row.outcome;
  }
  return buckets.map((b) => ({
    bin: b.bin,
    count: b.count,
    mean_probability: b.count ? b.probability_sum / b.count : null,
    observed_frequency: b.count ? b.outcome_sum / b.count : null,
  }));
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function quantile(sorted, q) {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[index];
}
export function eventClusterBootstrap(rows, { resamples = BOOTSTRAP_RESAMPLES, seed = BOOTSTRAP_SEED } = {}) {
  assert(Number.isInteger(resamples) && resamples > 0, "resamples must be positive integer");
  const byEvent = new Map();
  for (const row of rows) {
    if (!byEvent.has(row.event_id)) byEvent.set(row.event_id, []);
    byEvent.get(row.event_id).push(row);
  }
  const ids = [...byEvent.keys()].sort();
  assert(ids.length > 0, "bootstrap requires events");
  const rng = mulberry32(seed);
  const samples = [];
  for (let n = 0; n < resamples; n += 1) {
    const chosen = [];
    for (let i = 0; i < ids.length; i += 1) {
      const id = ids[Math.floor(rng() * ids.length)];
      chosen.push(...byEvent.get(id));
    }
    samples.push(scoreRows(chosen).paired_brier_improvement);
  }
  samples.sort((a, b) => a - b);
  return {
    resamples, seed,
    lower_95: quantile(samples, 0.025),
    upper_95: quantile(samples, 0.975),
    point_estimate: scoreRows(rows).paired_brier_improvement,
  };
}

export function regimeDiagnostics(rows) {
  const groups = { LOW: [], MID: [], HIGH: [] };
  for (const row of rows) groups[probabilityBand(row.p_control)].push(row);
  return Object.fromEntries(Object.entries(groups).map(([band, values]) => [
    band,
    { ...scoreRowsOrEmpty(values), adequate: values.length >= REGIME_MIN_PAIRED_DECISIONS },
  ]));
}
function scoreRowsOrEmpty(rows) {
  return rows.length ? scoreRows(rows) : {
    paired_decisions: 0, unique_events: 0, control_brier: null, treatment_brier: null,
    paired_brier_improvement: null, brier_skill_score: null, control_log_loss: null,
    treatment_log_loss: null, treatment_failure_rate: null,
  };
}
export function categoryDiagnostics(rows, { bootstrapResamples = 500, seed = BOOTSTRAP_SEED } = {}) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.category ?? "UNKNOWN";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const out = {};
  for (const [category, values] of [...groups.entries()].sort()) {
    const eventCount = new Set(values.map((x) => x.event_id)).size;
    out[category] = {
      ...scoreRows(values),
      resolved_events: eventCount,
      adequate: eventCount >= CATEGORY_MIN_RESOLVED_EVENTS,
      bootstrap: eventCount ? eventClusterBootstrap(values, { resamples: bootstrapResamples, seed }) : null,
    };
  }
  return out;
}

export function outlierRemovalDiagnostics(rows) {
  const byEvent = new Map();
  for (const row of rows) {
    const value = brierLoss(row.p_control, row.outcome) - brierLoss(row.p_treatment, row.outcome);
    if (!byEvent.has(row.event_id)) byEvent.set(row.event_id, { sum: 0, rows: [] });
    byEvent.get(row.event_id).sum += value;
    byEvent.get(row.event_id).rows.push(row);
  }
  const ranked = [...byEvent.entries()].sort((a, b) => b[1].sum - a[1].sum || a[0].localeCompare(b[0]));
  const result = {};
  for (const count of [1, 2, 3]) {
    const removed = new Set(ranked.filter(([, x]) => x.sum > 0).slice(0, count).map(([id]) => id));
    const kept = rows.filter((row) => !removed.has(row.event_id));
    result[`remove_top_${count}`] = {
      removed_event_ids: [...removed],
      paired_brier_improvement: kept.length ? scoreRows(kept).paired_brier_improvement : null,
      pass: kept.length > 0 && scoreRows(kept).paired_brier_improvement > 0,
    };
  }
  return result;
}

export function selectStabilitySubset(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.category ?? "UNKNOWN"}|${probabilityBand(row.p_control)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const selected = [];
  for (const [key, values] of [...groups.entries()].sort()) {
    values.sort((a, b) => sha256Hex(`${key}|${a.candidate_id}`).localeCompare(sha256Hex(`${key}|${b.candidate_id}`)));
    selected.push(...values.slice(0, Math.max(1, Math.ceil(values.length * 0.10))));
  }
  return selected.sort((a, b) => a.candidate_id.localeCompare(b.candidate_id));
}
export function evaluateProbabilityStability(triplets) {
  assert(Array.isArray(triplets) && triplets.length > 0, "triplets required");
  let passing = 0, spreadSum = 0, pairCount = 0;
  for (const values of triplets) {
    assert(Array.isArray(values) && values.length === 3, "each stability input must contain 3 forecasts");
    values.forEach((x) => prob(x, "stability probability"));
    const range = Math.max(...values) - Math.min(...values);
    if (range <= 0.05 + 1e-12) passing += 1;
    for (const [i, j] of [[0,1],[0,2],[1,2]]) { spreadSum += Math.abs(values[i] - values[j]); pairCount += 1; }
  }
  const passRate = passing / triplets.length;
  const mean = spreadSum / pairCount;
  return { triplet_count: triplets.length, triplet_pass_rate: passRate, mean_absolute_pairwise_spread: mean, pass: passRate >= 0.90 && mean <= 0.03 + 1e-12 };
}

export function createCohortState(cohort, { priorEventIds = [] } = {}) {
  assert(["OOS-A", "OOS-B"].includes(cohort), "cohort must be OOS-A or OOS-B");
  return {
    cohort, state: "collecting", selected_event_ids: [], resolved_event_ids: [],
    paired_eligible_decisions: 0, prior_event_ids: [...new Set(priorEventIds)].sort(),
    redesign_count: 0, treatment_version: "v1",
  };
}
export function addCohortEvent(state, eventId) {
  assert(state.state === "collecting", "events can only be added while collecting");
  assert(state.selected_event_ids.length < OOS_MAX_SELECTED_EVENTS, "selected-event maximum exceeded");
  assert(!state.selected_event_ids.includes(eventId), "event already selected");
  assert(!state.prior_event_ids.includes(eventId), "event reuse across cohorts is prohibited");
  state.selected_event_ids.push(eventId); state.selected_event_ids.sort(); return state;
}
export function recordResolvedEvent(state, eventId, decisions) {
  assert(state.selected_event_ids.includes(eventId), "resolved event must be selected");
  assert(!state.resolved_event_ids.includes(eventId), "event already resolved");
  assert(Number.isInteger(decisions) && decisions >= 0, "decision count invalid");
  state.resolved_event_ids.push(eventId); state.resolved_event_ids.sort();
  state.paired_eligible_decisions += decisions; return state;
}
export function cohortFloors(state) {
  return {
    resolved_events: state.resolved_event_ids.length,
    paired_eligible_decisions: state.paired_eligible_decisions,
    target_valid_resolved_events: OOS_TARGET_VALID_RESOLVED_EVENTS,
    evaluable: state.resolved_event_ids.length >= OOS_MIN_RESOLVED_EVENTS && state.paired_eligible_decisions >= OOS_MIN_PAIRED_DECISIONS,
  };
}
export function finalizeCohort(state, { treatmentQualityPass = null } = {}) {
  if (!cohortFloors(state).evaluable) { state.state = "data_insufficient"; return state; }
  state.state = "evaluable";
  if (treatmentQualityPass === true) state.state = "pass";
  if (treatmentQualityPass === false) state.state = state.cohort === "OOS-A" ? "fail_treatment_quality" : "final_fail";
  return state;
}
export function applySingleRedesign(state, newVersion) {
  assert(state.cohort === "OOS-A" && state.state === "fail_treatment_quality", "redesign requires OOS-A treatment-quality failure");
  assert(state.redesign_count === 0, "exactly one redesign is allowed");
  assert(typeof newVersion === "string" && newVersion && newVersion !== state.treatment_version, "new treatment version required");
  state.redesign_count = 1; state.treatment_version = newVersion; state.state = "redesign_frozen"; return state;
}
export function createOosBState(oosA) {
  assert(["pass", "redesign_frozen"].includes(oosA.state), "OOS-B requires OOS-A pass or frozen redesign");
  const state = createCohortState("OOS-B", { priorEventIds: oosA.selected_event_ids });
  state.redesign_count = oosA.redesign_count;
  state.treatment_version = oosA.treatment_version;
  return state;
}

export function evaluateFuturePassGate({
  observations, bootstrap, leakage_pass, provenance_pass, stability_pass,
  outlier_pass, category_pass, regime_robustness_pass,
}) {
  const metrics = forecastMetrics(observations);
  const evaluable = metrics.unique_events >= OOS_MIN_RESOLVED_EVENTS && metrics.paired_decisions >= OOS_MIN_PAIRED_DECISIONS;
  const criteria = {
    sample_floors: evaluable,
    bss_effect_size: metrics.brier_skill_score !== null && metrics.brier_skill_score >= 0.02,
    paired_improvement: metrics.paired_brier_improvement > 0,
    clustered_lower_bound: bootstrap?.lower_95 > 0,
    treatment_failure_rate: metrics.treatment_failure_rate <= 0.05,
    leakage: leakage_pass === true, provenance: provenance_pass === true, stability: stability_pass === true,
    outlier_removal: outlier_pass === true, category_robustness: category_pass === true,
    regime_robustness: regime_robustness_pass === true,
  };
  return { evaluable, pass: Object.values(criteria).every(Boolean), criteria, metrics, note: "BSS >=0.02 is a practical effect-size floor, not a power guarantee" };
}

const allowed = [/weather/u,/climate/u,/science/u,/technology/u,/\btech\b/u,/economic/u,/entertain/u,/culture/u];
const excluded = [/election/u,/candidate/u,/politic/u,/ballot/u,/president/u,/congress/u,/senate/u,/governor/u,/sports?/u,/gaming/u,/football/u,/basketball/u,/baseball/u,/hockey/u,/soccer/u,/tennis/u,/\bwar\b/u,/terror/u,/assassin/u,/unlawful/u];
export function qualificationCategory(event) {
  const category = String(event?.category ?? "").trim();
  const text = `${category} ${String(event?.title ?? "")} ${String(event?.sub_title ?? "")}`.toLowerCase();
  if (excluded.some((r) => r.test(text))) return { eligible: false, reason: "excluded_initial_universe", category: category || "UNKNOWN" };
  if (!allowed.some((r) => r.test(text))) return { eligible: false, reason: "category_not_in_initial_universe", category: category || "UNKNOWN" };
  return { eligible: true, reason: "allowed_initial_universe", category: category || "UNKNOWN" };
}

export function schemaFingerprint(value) {
  function shape(item) {
    if (item === null) return "null";
    if (Array.isArray(item)) return { type: "array", item_shapes: [...new Set(item.slice(0, 10).map((x) => canonicalSerialize(shape(x))))].sort() };
    if (typeof item === "object") return { type: "object", fields: Object.fromEntries(Object.keys(item).sort().map((k) => [k, shape(item[k])])) };
    return typeof item;
  }
  return sha256Hex(canonicalSerialize(shape(value)));
}

export function buildPhase0bEvidence({ runId, recordedAtUtc, entries }) {
  iso(recordedAtUtc, "recordedAtUtc");
  let prev = null;
  const records = entries.map((entry, sequence) => {
    const record = buildEvidenceRecord({
      run_id: runId, sequence, event_type: entry.event_type,
      recorded_at_utc: entry.recorded_at_utc ?? recordedAtUtc,
      payload: entry.payload, prev_record_hash: prev,
    });
    prev = record.record_hash; return record;
  });
  validateLedgerRecords(records);
  return { records, digest: canonicalLedgerDigest(records) };
}
