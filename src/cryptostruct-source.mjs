import { canonicalSerialize, isSha256Hex, sha256Hex } from "./canonical.mjs";
import { buildEvidenceRecord } from "./ledger.mjs";

export const CRYPTOSTRUCT_MCP_ENDPOINT = "https://cryptostruct.com/mcp";
export const CRYPTOSTRUCT_PROVIDER = "cryptostruct";
export const CRYPTOSTRUCT_UNDERLYING_VENUE = "polymarket";
export const CRYPTOSTRUCT_ALLOWED_TOOLS = Object.freeze([
  "search_instruments",
  "get_instrument",
  "get_market_snapshot",
]);
export const PHASE0B_ALLOWED_CATEGORIES = Object.freeze([
  "WEATHER_CLIMATE",
  "MACROECONOMICS",
  "SCIENCE_TECHNOLOGY",
  "ENTERTAINMENT_CULTURE",
]);
export const PHASE0B_CUTOFF_HOURS = Object.freeze([24, 6, 1]);
export const QUALITY_GATE = Object.freeze({
  min_trades_60m: 5,
  min_turnover_usd_60m: 100,
  min_top1_depth_min_side_usd_60m: 50,
  max_spread_bps_60m_avg: 2000,
  max_response_lag_ms: 60_000,
});
export const COHORT_FLOORS = Object.freeze({
  max_selected_events: 150,
  target_valid_resolved_events: 120,
  min_unique_resolved_events: 100,
  min_paired_eligible_decisions: 300,
});
export const CRYPTOSTRUCT_REJECTION_REASON_CODES = Object.freeze([
  "independent_criteria_changed",
  "semantic_mapping_unproven",
  "frozen_instrument_changed",
  "frozen_instrument_code_changed",
  "deadline_changed",
  "event_not_open_or_unresolved",
  "wrong_venue",
  "not_binary_prediction",
  "orientation_ambiguous",
  "price_semantics_unqualified",
  "unstable_instrument_id",
  "malformed_instrument",
  "snapshot_instrument_mismatch",
  "request_not_started_at_cutoff",
  "response_outside_cutoff_window",
  "stale_or_future_snapshot_capture",
  "malformed_timing",
  "low_trades_60m",
  "low_turnover_60m",
  "low_top1_depth",
  "invalid_or_wide_spread",
  "provenance_missing",
  "malformed_or_undocumented_source",
  "rate_limited_primary_observation",
  "source_error",
  "source_unavailable",
  "tool_removed",
  "tool_schema_changed",
  "required_fields_missing",
  "rate_limited",
  "auth_required",
  "premium_required",
  "purchase_required",
  "license_changed",
]);

export const CRYPTOSTRUCT_SOURCE_CONTRACT = Object.freeze({
  contract: "ldw-release-0.5.1-cryptostruct-live-schema-normalization",
  provider: CRYPTOSTRUCT_PROVIDER,
  endpoint: CRYPTOSTRUCT_MCP_ENDPOINT,
  underlying_venue: CRYPTOSTRUCT_UNDERLYING_VENUE,
  provider_semantics: {
    venue: "polymarket",
    instrument_type: "prediction",
    orientation: "YES",
    price_semantics: "probability_0_1",
  },
  wire: {
    jsonrpc: "2.0",
    tool_payload: "result.content[].text JSON",
  },
  normalized_snapshot: {
    captured_at_utc: "as_of",
    p_control: "price_last",
    trades_60m: "last_60m.trades",
    turnover_usd_60m: "last_60m.turnover_usd",
    spread_bps_60m_avg: "last_60m.spread_bps_avg",
    top1_depth_bid_usd_60m: "last_60m.top1_depth_usd.bid",
    top1_depth_ask_usd_60m: "last_60m.top1_depth_usd.ask",
    top1_depth_min_side_usd_60m: "min(bid,ask)",
  },
  quality_gate: QUALITY_GATE,
});

const PROHIBITED_PUBLIC_FIELDS = new Set([
  "cryptostruct_instrument_id",
  "cryptostruct_code",
  "instrument_id",
  "instrument_code",
  "p_control",
  "trades_60m",
  "turnover_usd_60m",
  "spread_bps_60m_avg",
  "top1_depth_bid_usd_60m",
  "top1_depth_ask_usd_60m",
  "top1_depth_min_side_usd_60m",
  "raw_response",
  "raw_orderbook",
]);
const ACCESS_FAILURES = new Set([
  "SOURCE_UNAVAILABLE",
  "TOOL_REMOVED",
  "TOOL_SCHEMA_CHANGED",
  "REQUIRED_FIELDS_MISSING",
  "RATE_LIMITED",
  "AUTH_REQUIRED",
  "PREMIUM_REQUIRED",
  "PURCHASE_REQUIRED",
  "LICENSE_CHANGED",
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function plain(value, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value;
}

function nonEmpty(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a non-empty string`);
  return value.trim();
}

function iso(value, label) {
  nonEmpty(value, label);
  assert(value.endsWith("Z") && !Number.isNaN(Date.parse(value)), `${label} must be ISO-8601 UTC`);
  return value;
}

function finiteNumber(value, label) {
  assert(typeof value === "number" && Number.isFinite(value), `${label} must be finite`);
  return value;
}

function probability(value, label) {
  finiteNumber(value, label);
  assert(value >= 0 && value <= 1, `${label} must be in [0,1]`);
  return value;
}

function nonNegative(value, label) {
  finiteNumber(value, label);
  assert(value >= 0, `${label} must be non-negative`);
  return value;
}

function integerAtLeast(value, minimum, label) {
  assert(Number.isInteger(value) && value >= minimum, `${label} must be an integer >= ${minimum}`);
  return value;
}

function closedKeys(value, allowed, label) {
  plain(value, label);
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) assert(allowedSet.has(key), `${label} contains unknown field: ${key}`);
}

function schemaShape(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    const itemShapes = [...new Set(value.map((item) => canonicalSerialize(schemaShape(item))))].sort();
    return { type: "array", items: itemShapes.map((item) => JSON.parse(item)) };
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, schemaShape(value[key])]),
    );
  }
  return typeof value;
}

export function sourceSchemaFingerprint(value) {
  return sha256Hex(canonicalSerialize(schemaShape(value)));
}

export function cryptoStructSourceContractHash() {
  return sha256Hex(canonicalSerialize(CRYPTOSTRUCT_SOURCE_CONTRACT));
}

export function cryptoStructMcpContract() {
  return Object.freeze({
    endpoint: CRYPTOSTRUCT_MCP_ENDPOINT,
    transport: "streamable-http-stateless",
    free_tier: "keyless",
    operational_access_authorized: false,
    allowed_tools: [...CRYPTOSTRUCT_ALLOWED_TOOLS],
    source_contract_hash: cryptoStructSourceContractHash(),
    documented_semantics: {
      search_instruments: "candidate discovery only; never semantic/category authority",
      get_instrument: "stable instrument identity/masterdata for mapping and open-state checks",
      get_market_snapshot: "price_last plus nested last_60m quality metrics",
    },
    documented_units: {
      turnover: "USD",
      depth: "USD",
      spread: "basis points",
      prediction_market_price: "0..1 probability for Polymarket Yes contract",
    },
  });
}

export function createCryptoStructSourceAdapter({ invokeTool = null, operationalAccessAuthorized = false } = {}) {
  const call = async (tool, args = {}) => {
    assert(CRYPTOSTRUCT_ALLOWED_TOOLS.includes(tool), `tool not authorized in Release 0.5: ${tool}`);
    if (!operationalAccessAuthorized) {
      const error = new Error("OWNER_LICENSE_ACCEPTANCE_REQUIRED");
      error.code = "OWNER_LICENSE_ACCEPTANCE_REQUIRED";
      throw error;
    }
    assert(typeof invokeTool === "function", "invokeTool function required for operational access");
    return invokeTool(tool, structuredClone(args));
  };
  return Object.freeze({
    provider: CRYPTOSTRUCT_PROVIDER,
    endpoint: CRYPTOSTRUCT_MCP_ENDPOINT,
    operational_access_authorized: operationalAccessAuthorized,
    searchInstruments: (args) => call("search_instruments", args),
    getInstrument: (args) => call("get_instrument", args),
    getMarketSnapshot: (args) => call("get_market_snapshot", args),
  });
}

export function parseMcpToolEnvelope(envelope, toolName) {
  assert(CRYPTOSTRUCT_ALLOWED_TOOLS.includes(toolName), `unsupported tool envelope: ${toolName}`);
  closedKeys(envelope, ["jsonrpc", "id", "result"], `${toolName} JSON-RPC envelope`);
  assert(envelope.jsonrpc === "2.0", `${toolName} jsonrpc must be 2.0`);
  assert(
    (typeof envelope.id === "number" && Number.isFinite(envelope.id))
      || (typeof envelope.id === "string" && envelope.id.length > 0),
    `${toolName} id must be a finite number or non-empty string`,
  );
  const result = plain(envelope.result, `${toolName}.result`);
  closedKeys(result, ["content"], `${toolName}.result`);
  assert(Array.isArray(result.content) && result.content.length > 0, `${toolName} result missing MCP content`);
  for (const [index, part] of result.content.entries()) {
    closedKeys(part, ["type", "text"], `${toolName}.result.content[${index}]`);
  }
  const textPart = result.content.find((part) => part.type === "text" && typeof part.text === "string");
  assert(textPart, `${toolName} envelope missing text content`);
  let parsed;
  try {
    parsed = JSON.parse(textPart.text);
  } catch (error) {
    throw new Error(`${toolName} text content is not JSON: ${error.message}`);
  }
  return plain(parsed, `${toolName} parsed result`);
}

export function parseSearchInstrumentsResult(result) {
  closedKeys(result, ["total_matching", "showing", "hits"], "search_instruments result");
  integerAtLeast(result.total_matching, 0, "search_instruments.total_matching");
  integerAtLeast(result.showing, 0, "search_instruments.showing");
  assert(Array.isArray(result.hits), "search_instruments.hits must be an array");
  assert(result.showing === result.hits.length, "search_instruments.showing must equal hits length");
  assert(result.showing <= result.total_matching, "search_instruments.showing cannot exceed total_matching");
  const instruments = result.hits.map((item, index) => {
    closedKeys(item, [
      "instrument_id",
      "code",
      "type",
      "venue",
      "venue_name",
      "base",
      "quote",
      "state",
      "days_with_data",
      "first_day",
      "last_day",
      "total_bytes_compressed",
    ], `search_instruments.hits[${index}]`);
    integerAtLeast(item.instrument_id, 1, "instrument_id");
    integerAtLeast(item.days_with_data, 0, "days_with_data");
    integerAtLeast(item.total_bytes_compressed, 0, "total_bytes_compressed");
    return Object.freeze({
      instrument_id: String(item.instrument_id),
      code: nonEmpty(item.code, "code"),
      instrument_class: nonEmpty(item.type, "type").toLowerCase(),
      venue: nonEmpty(item.venue, "venue").toLowerCase(),
      venue_name: nonEmpty(item.venue_name, "venue_name"),
      base: nonEmpty(item.base, "base"),
      quote: nonEmpty(item.quote, "quote"),
      state: nonEmpty(item.state, "state").toLowerCase(),
      days_with_data: item.days_with_data,
      first_day: nonEmpty(item.first_day, "first_day"),
      last_day: nonEmpty(item.last_day, "last_day"),
      total_bytes_compressed: item.total_bytes_compressed,
    });
  });
  return Object.freeze({
    total_matching: result.total_matching,
    showing: result.showing,
    instruments,
    source_schema_fingerprint: sourceSchemaFingerprint(result),
  });
}

function providerSemanticsForInstrument({ venue, instrument_class }) {
  if (String(venue).toLowerCase() !== CRYPTOSTRUCT_UNDERLYING_VENUE) {
    return { valid: false, reason: "wrong_venue" };
  }
  if (String(instrument_class).toLowerCase() !== "prediction") {
    return { valid: false, reason: "not_binary_prediction" };
  }
  return {
    valid: true,
    reason: "provider_probability_semantics",
    orientation: "YES",
    price_semantics: "probability_0_1",
  };
}

export function parseGetInstrumentResult(result) {
  closedKeys(result, [
    "instrument_id",
    "code",
    "type",
    "venue",
    "venue_name",
    "base",
    "quote",
    "state",
    "days_with_data",
    "first_day",
    "last_day",
    "total_bytes_compressed",
    "listed_since",
  ], "get_instrument result");
  integerAtLeast(result.instrument_id, 1, "instrument_id");
  integerAtLeast(result.days_with_data, 0, "days_with_data");
  integerAtLeast(result.total_bytes_compressed, 0, "total_bytes_compressed");
  const instrument_class = nonEmpty(result.type, "type").toLowerCase();
  const venue = nonEmpty(result.venue, "venue").toLowerCase();
  const providerSemantics = providerSemanticsForInstrument({ venue, instrument_class });
  return Object.freeze({
    instrument_id: String(result.instrument_id),
    code: nonEmpty(result.code, "code"),
    instrument_class,
    venue,
    venue_name: nonEmpty(result.venue_name, "venue_name"),
    base: nonEmpty(result.base, "base"),
    quote: nonEmpty(result.quote, "quote"),
    state: nonEmpty(result.state, "state").toLowerCase(),
    days_with_data: result.days_with_data,
    first_day: nonEmpty(result.first_day, "first_day"),
    last_day: nonEmpty(result.last_day, "last_day"),
    total_bytes_compressed: result.total_bytes_compressed,
    listed_since: nonEmpty(result.listed_since, "listed_since"),
    orientation: providerSemantics.valid ? providerSemantics.orientation : null,
    price_semantics: providerSemantics.valid ? providerSemantics.price_semantics : null,
    source_schema_fingerprint: sourceSchemaFingerprint(result),
  });
}

export function parseGetMarketSnapshotResult(result) {
  closedKeys(result, [
    "instrument_id",
    "code",
    "venue",
    "as_of",
    "price_last",
    "change_24h_pct",
    "vwap_last_minute",
    "last_60m",
    "last_24h",
  ], "get_market_snapshot result");
  integerAtLeast(result.instrument_id, 1, "snapshot.instrument_id");
  const last60 = plain(result.last_60m, "snapshot.last_60m");
  closedKeys(last60, [
    "turnover_usd",
    "turnover_buy_usd",
    "turnover_sell_usd",
    "trades",
    "liquidations",
    "spread_bps_avg",
    "top1_depth_usd",
    "top20_depth_usd",
  ], "snapshot.last_60m");
  integerAtLeast(last60.trades, 0, "snapshot.last_60m.trades");
  integerAtLeast(last60.liquidations, 0, "snapshot.last_60m.liquidations");
  for (const field of ["turnover_usd", "turnover_buy_usd", "turnover_sell_usd", "spread_bps_avg"]) {
    nonNegative(last60[field], `snapshot.last_60m.${field}`);
  }
  const top1 = plain(last60.top1_depth_usd, "snapshot.last_60m.top1_depth_usd");
  const top20 = plain(last60.top20_depth_usd, "snapshot.last_60m.top20_depth_usd");
  closedKeys(top1, ["bid", "ask"], "snapshot.last_60m.top1_depth_usd");
  closedKeys(top20, ["bid", "ask"], "snapshot.last_60m.top20_depth_usd");
  for (const side of ["bid", "ask"]) {
    nonNegative(top1[side], `snapshot.last_60m.top1_depth_usd.${side}`);
    nonNegative(top20[side], `snapshot.last_60m.top20_depth_usd.${side}`);
  }
  probability(result.price_last, "snapshot.price_last");
  const bid = top1.bid;
  const ask = top1.ask;
  return Object.freeze({
    instrument_id: String(result.instrument_id),
    code: nonEmpty(result.code, "snapshot.code"),
    venue: nonEmpty(result.venue, "snapshot.venue").toLowerCase(),
    captured_at_utc: iso(result.as_of, "snapshot.as_of"),
    p_control: result.price_last,
    trades_60m: last60.trades,
    turnover_usd_60m: last60.turnover_usd,
    spread_bps_60m_avg: last60.spread_bps_avg,
    top1_depth_bid_usd_60m: bid,
    top1_depth_ask_usd_60m: ask,
    top1_depth_min_side_usd_60m: Math.min(bid, ask),
    source_schema_fingerprint: sourceSchemaFingerprint(result),
  });
}

export function validateSourceMappingRecord(record) {
  closedKeys(record, [
    "schema_version",
    "independent_event_spec_hash",
    "cryptostruct_instrument_id",
    "cryptostruct_code",
    "venue",
    "type",
    "mapping_review_timestamp",
    "mapping_evidence_hash",
    "mapping_status",
  ], "SourceMappingRecord");
  assert(record.schema_version === "cryptostruct-source-mapping-record.v1", "SourceMappingRecord schema_version mismatch");
  assert(isSha256Hex(record.independent_event_spec_hash), "SourceMappingRecord independent_event_spec_hash must be SHA-256 hex");
  nonEmpty(record.cryptostruct_instrument_id, "SourceMappingRecord cryptostruct_instrument_id");
  nonEmpty(record.cryptostruct_code, "SourceMappingRecord cryptostruct_code");
  assert(record.venue === CRYPTOSTRUCT_UNDERLYING_VENUE, "SourceMappingRecord venue must be polymarket");
  assert(record.type === "prediction", "SourceMappingRecord type must be prediction");
  iso(record.mapping_review_timestamp, "SourceMappingRecord mapping_review_timestamp");
  assert(isSha256Hex(record.mapping_evidence_hash), "SourceMappingRecord mapping_evidence_hash must be SHA-256 hex");
  assert(record.mapping_status === "VERIFIED", "SourceMappingRecord mapping_status must be VERIFIED");
  return record;
}

export function createSourceMappingRecord(input) {
  const record = {
    schema_version: "cryptostruct-source-mapping-record.v1",
    independent_event_spec_hash: input.independent_event_spec_hash,
    cryptostruct_instrument_id: String(input.cryptostruct_instrument_id),
    cryptostruct_code: nonEmpty(input.cryptostruct_code, "cryptostruct_code"),
    venue: String(input.venue).toLowerCase(),
    type: String(input.type).toLowerCase(),
    mapping_review_timestamp: input.mapping_review_timestamp,
    mapping_evidence_hash: input.mapping_evidence_hash,
    mapping_status: input.mapping_status,
  };
  validateSourceMappingRecord(record);
  return Object.freeze(record);
}

export function sourceMappingRecordHash(record) {
  validateSourceMappingRecord(record);
  return sha256Hex(canonicalSerialize(record));
}

export function validateSourceMappingForSpec({ spec, instrument, mapping_record }) {
  try {
    validateIndependentEventSpec(spec);
    if (!mapping_record || mapping_record.mapping_status !== "VERIFIED") {
      return { valid: false, reason: "semantic_mapping_unproven" };
    }
    validateSourceMappingRecord(mapping_record);
    if (mapping_record.independent_event_spec_hash !== independentEventSpecHash(spec)) {
      return { valid: false, reason: "semantic_mapping_unproven" };
    }
    if (
      mapping_record.cryptostruct_instrument_id !== instrument.instrument_id
      || mapping_record.cryptostruct_code !== instrument.code
      || mapping_record.venue !== instrument.venue
      || mapping_record.type !== instrument.instrument_class
    ) {
      return { valid: false, reason: "semantic_mapping_unproven" };
    }
    return {
      valid: true,
      reason: "verified_source_mapping",
      source_mapping_record_hash: sourceMappingRecordHash(mapping_record),
    };
  } catch {
    return { valid: false, reason: "semantic_mapping_unproven" };
  }
}

export function validateIndependentEventSpec(spec) {
  closedKeys(spec, [
    "schema_version",
    "event_id",
    "canonical_question",
    "yes_condition",
    "no_condition",
    "category",
    "deadline_utc",
    "resolution_authority",
    "resolution_reference",
    "criteria_hash",
    "allowed_cutoffs",
  ], "IndependentEventSpec");
  assert(spec.schema_version === "independent-event-spec.v1", "IndependentEventSpec schema_version mismatch");
  nonEmpty(spec.event_id, "event_id");
  nonEmpty(spec.canonical_question, "canonical_question");
  nonEmpty(spec.yes_condition, "yes_condition");
  nonEmpty(spec.no_condition, "no_condition");
  assert(PHASE0B_ALLOWED_CATEGORIES.includes(spec.category), `category not allowed: ${spec.category}`);
  iso(spec.deadline_utc, "deadline_utc");
  nonEmpty(spec.resolution_authority, "resolution_authority");
  nonEmpty(spec.resolution_reference, "resolution_reference");
  assert(isSha256Hex(spec.criteria_hash), "criteria_hash must be SHA-256 hex");
  assert(Array.isArray(spec.allowed_cutoffs) && spec.allowed_cutoffs.length === 3, "allowed_cutoffs must contain exactly three entries");
  assert(JSON.stringify(spec.allowed_cutoffs) === JSON.stringify(["T-24h", "T-6h", "T-1h"]), "allowed_cutoffs must be T-24h/T-6h/T-1h");
  return spec;
}

export function createIndependentEventSpec(input) {
  const spec = {
    schema_version: "independent-event-spec.v1",
    event_id: nonEmpty(input.event_id, "event_id"),
    canonical_question: nonEmpty(input.canonical_question, "canonical_question"),
    yes_condition: nonEmpty(input.yes_condition, "yes_condition"),
    no_condition: nonEmpty(input.no_condition, "no_condition"),
    category: input.category,
    deadline_utc: input.deadline_utc,
    resolution_authority: nonEmpty(input.resolution_authority, "resolution_authority"),
    resolution_reference: nonEmpty(input.resolution_reference, "resolution_reference"),
    criteria_hash: input.criteria_hash,
    allowed_cutoffs: ["T-24h", "T-6h", "T-1h"],
  };
  validateIndependentEventSpec(spec);
  return Object.freeze(spec);
}

export function independentEventSpecHash(spec) {
  validateIndependentEventSpec(spec);
  return sha256Hex(canonicalSerialize(spec));
}

export function treatmentContextFromIndependentSpec(spec, cutoffUtc) {
  validateIndependentEventSpec(spec);
  iso(cutoffUtc, "observation cutoff");
  const allowed = plannedCryptoStructCutoffs(spec.deadline_utc).some((item) => item.cutoff_utc === cutoffUtc);
  assert(allowed, "observation cutoff is not one of the frozen T-24h/T-6h/T-1h cutoffs");
  const context = {
    canonical_question: spec.canonical_question,
    yes_condition: spec.yes_condition,
    no_condition: spec.no_condition,
    category: spec.category,
    deadline_utc: spec.deadline_utc,
    observation_cutoff_utc: cutoffUtc,
    resolution_source_label: spec.resolution_authority,
    resolution_reference: spec.resolution_reference,
  };
  return { context, context_hash: sha256Hex(canonicalSerialize(context)) };
}

export function plannedCryptoStructCutoffs(deadlineUtc) {
  iso(deadlineUtc, "deadlineUtc");
  const deadline = Date.parse(deadlineUtc);
  return PHASE0B_CUTOFF_HOURS.map((hours) => ({
    label: `T-${hours}h`,
    hours_before_deadline: hours,
    cutoff_utc: new Date(deadline - hours * 3_600_000).toISOString(),
  }));
}

export function validatePolymarketBinaryOrientation(instrument) {
  try {
    plain(instrument, "instrument");
    const semantics = providerSemanticsForInstrument(instrument);
    if (!semantics.valid) return semantics;
    if (instrument.orientation !== "YES") return { valid: false, reason: "orientation_ambiguous" };
    if (instrument.price_semantics !== "probability_0_1") return { valid: false, reason: "price_semantics_unqualified" };
    if (!instrument.instrument_id || !instrument.code) return { valid: false, reason: "unstable_instrument_id" };
    return {
      valid: true,
      reason: "eligible_orientation",
      orientation: "YES",
      price_semantics: "probability_0_1",
    };
  } catch (error) {
    return { valid: false, reason: "malformed_instrument", detail: error.message };
  }
}

export function validateCutoffTiming({ cutoff_utc, request_start_utc, request_complete_utc, snapshot_capture_utc }) {
  try {
    const cutoff = Date.parse(iso(cutoff_utc, "cutoff_utc"));
    const start = Date.parse(iso(request_start_utc, "request_start_utc"));
    const complete = Date.parse(iso(request_complete_utc, "request_complete_utc"));
    const capture = Date.parse(iso(snapshot_capture_utc, "snapshot_capture_utc"));
    if (start !== cutoff) return { valid: false, reason: "request_not_started_at_cutoff" };
    if (complete < start || complete > cutoff + QUALITY_GATE.max_response_lag_ms) return { valid: false, reason: "response_outside_cutoff_window" };
    if (capture < start || capture > complete) return { valid: false, reason: "stale_or_future_snapshot_capture" };
    return { valid: true, reason: "timing_valid" };
  } catch (error) {
    return { valid: false, reason: "malformed_timing", detail: error.message };
  }
}

export function evaluateCryptoStructSourceQuality({
  spec,
  frozen_spec_hash,
  frozen_instrument_id,
  frozen_instrument_code,
  instrument,
  snapshot,
  source_mapping_record,
  frozen_source_mapping_record_hash = null,
  source_contract_hash = cryptoStructSourceContractHash(),
  cutoff_utc,
  request_start_utc,
  request_complete_utc,
}) {
  try {
    validateIndependentEventSpec(spec);
    const currentSpecHash = independentEventSpecHash(spec);
    if (currentSpecHash !== frozen_spec_hash) return { eligible: false, reason: "independent_criteria_changed" };
    if (instrument.instrument_id !== frozen_instrument_id) return { eligible: false, reason: "frozen_instrument_changed" };
    if (instrument.code !== frozen_instrument_code) return { eligible: false, reason: "frozen_instrument_code_changed" };
    if (instrument.state !== "open") return { eligible: false, reason: "event_not_open_or_unresolved" };
    const orientation = validatePolymarketBinaryOrientation(instrument);
    if (!orientation.valid) return { eligible: false, reason: orientation.reason };
    const mapping = validateSourceMappingForSpec({ spec, instrument, mapping_record: source_mapping_record });
    if (!mapping.valid) return { eligible: false, reason: mapping.reason };
    if (frozen_source_mapping_record_hash !== null && mapping.source_mapping_record_hash !== frozen_source_mapping_record_hash) {
      return { eligible: false, reason: "semantic_mapping_unproven" };
    }
    if (snapshot.instrument_id !== frozen_instrument_id || snapshot.code !== frozen_instrument_code) {
      return { eligible: false, reason: "snapshot_instrument_mismatch" };
    }
    if (snapshot.venue !== CRYPTOSTRUCT_UNDERLYING_VENUE) return { eligible: false, reason: "wrong_venue" };
    const timing = validateCutoffTiming({
      cutoff_utc,
      request_start_utc,
      request_complete_utc,
      snapshot_capture_utc: snapshot.captured_at_utc,
    });
    if (!timing.valid) return { eligible: false, reason: timing.reason };
    probability(snapshot.p_control, "snapshot.p_control");
    if (snapshot.trades_60m < QUALITY_GATE.min_trades_60m) return { eligible: false, reason: "low_trades_60m" };
    if (snapshot.turnover_usd_60m < QUALITY_GATE.min_turnover_usd_60m) return { eligible: false, reason: "low_turnover_60m" };
    if (snapshot.top1_depth_min_side_usd_60m < QUALITY_GATE.min_top1_depth_min_side_usd_60m) {
      return { eligible: false, reason: "low_top1_depth" };
    }
    if (snapshot.spread_bps_60m_avg > QUALITY_GATE.max_spread_bps_60m_avg) {
      return { eligible: false, reason: "invalid_or_wide_spread" };
    }
    if (
      !isSha256Hex(instrument.source_schema_fingerprint)
      || !isSha256Hex(snapshot.source_schema_fingerprint)
      || source_contract_hash !== cryptoStructSourceContractHash()
    ) {
      return { eligible: false, reason: "provenance_missing" };
    }
    return {
      eligible: true,
      reason: "eligible",
      p_control: snapshot.p_control,
      orientation: orientation.orientation,
      source_mapping_record_hash: mapping.source_mapping_record_hash,
      source_schema_fingerprint: snapshot.source_schema_fingerprint,
      source_contract_hash,
      quality: {
        trades_60m: snapshot.trades_60m,
        turnover_usd_60m: snapshot.turnover_usd_60m,
        spread_bps_60m_avg: snapshot.spread_bps_60m_avg,
        top1_depth_bid_usd_60m: snapshot.top1_depth_bid_usd_60m,
        top1_depth_ask_usd_60m: snapshot.top1_depth_ask_usd_60m,
        top1_depth_min_side_usd_60m: snapshot.top1_depth_min_side_usd_60m,
      },
    };
  } catch (error) {
    return { eligible: false, reason: "malformed_or_undocumented_source", detail: error.message };
  }
}

export function selectCryptoStructInstrument(candidates) {
  assert(Array.isArray(candidates) && candidates.length > 0, "selector requires candidates");
  const eligible = candidates.filter((candidate) => candidate?.eligibility?.eligible === true);
  assert(eligible.length > 0, "selector has no source-eligible instruments");
  eligible.sort((left, right) => {
    const lq = left.eligibility.quality;
    const rq = right.eligibility.quality;
    if (lq.turnover_usd_60m !== rq.turnover_usd_60m) return rq.turnover_usd_60m - lq.turnover_usd_60m;
    if (lq.trades_60m !== rq.trades_60m) return rq.trades_60m - lq.trades_60m;
    if (lq.spread_bps_60m_avg !== rq.spread_bps_60m_avg) return lq.spread_bps_60m_avg - rq.spread_bps_60m_avg;
    if (lq.top1_depth_min_side_usd_60m !== rq.top1_depth_min_side_usd_60m) {
      return rq.top1_depth_min_side_usd_60m - lq.top1_depth_min_side_usd_60m;
    }
    return String(left.instrument.instrument_id).localeCompare(String(right.instrument.instrument_id));
  });
  const chosen = eligible[0];
  const mappingHash = chosen.eligibility.source_mapping_record_hash
    ?? sourceMappingRecordHash(chosen.source_mapping_record);
  return Object.freeze({
    independent_event_id: chosen.spec.event_id,
    independent_event_spec_hash: independentEventSpecHash(chosen.spec),
    instrument_id: chosen.instrument.instrument_id,
    instrument_code: chosen.instrument.code,
    source_mapping_record_hash: mappingHash,
    underlying_venue: CRYPTOSTRUCT_UNDERLYING_VENUE,
    orientation: "YES",
    frozen_deadline_utc: chosen.spec.deadline_utc,
    selected_at_cutoff: "T-24h",
  });
}

export function validateFrozenCryptoStructSelection(selection, { spec, instrument, source_mapping_record }) {
  if (selection.independent_event_spec_hash !== independentEventSpecHash(spec)) return { valid: false, reason: "independent_criteria_changed" };
  if (selection.instrument_id !== instrument.instrument_id) return { valid: false, reason: "frozen_instrument_changed" };
  if (selection.instrument_code !== instrument.code) return { valid: false, reason: "frozen_instrument_code_changed" };
  if (selection.frozen_deadline_utc !== spec.deadline_utc) return { valid: false, reason: "deadline_changed" };
  const mapping = validateSourceMappingForSpec({ spec, instrument, mapping_record: source_mapping_record });
  if (!mapping.valid || mapping.source_mapping_record_hash !== selection.source_mapping_record_hash) {
    return { valid: false, reason: "semantic_mapping_unproven" };
  }
  return { valid: true, reason: "frozen_selection_valid" };
}

export function deduplicateEventCandidates(candidates) {
  assert(Array.isArray(candidates), "candidates must be an array");
  const seenSpecs = new Set();
  const seenClusters = new Set();
  const seenAliases = new Set();
  const accepted = [];
  const rejected = [];
  for (const candidate of [...candidates].sort((a, b) => String(a.spec.event_id).localeCompare(String(b.spec.event_id)))) {
    const specHash = independentEventSpecHash(candidate.spec);
    const cluster = nonEmpty(candidate.event_cluster_id, "event_cluster_id");
    const alias = nonEmpty(candidate.semantic_alias_key, "semantic_alias_key").toLowerCase();
    let reason = null;
    if (seenSpecs.has(specHash)) reason = "duplicate_independent_event_spec";
    else if (seenClusters.has(cluster)) reason = "correlated_event_cluster";
    else if (seenAliases.has(alias)) reason = "semantic_alias_duplicate";
    seenSpecs.add(specHash);
    seenClusters.add(cluster);
    seenAliases.add(alias);
    if (reason) {
      rejected.push({ event_id: candidate.spec.event_id, reason });
      continue;
    }
    accepted.push(candidate);
  }
  return { accepted, rejected };
}

export function createResolutionState(spec) {
  validateIndependentEventSpec(spec);
  return Object.freeze({
    state: "pending",
    event_id: spec.event_id,
    independent_event_spec_hash: independentEventSpecHash(spec),
    outcome: null,
    authority_reference: null,
    retrieved_at_utc: null,
    evidence_hash: null,
    reason: null,
  });
}

export function applyIndependentResolution(state, spec, evidence) {
  validateIndependentEventSpec(spec);
  assert(state?.state === "pending", "resolution state is already terminal");
  if (state.event_id !== spec.event_id || state.independent_event_spec_hash !== independentEventSpecHash(spec)) {
    return Object.freeze({ ...state, state: "invalid", reason: "independent_criteria_changed" });
  }
  plain(evidence, "resolution evidence");
  if (evidence.source_basis === "cryptostruct_price" || evidence.source_basis === "market_price") {
    return Object.freeze({ ...state, state: "invalid", reason: "price_based_resolution_prohibited" });
  }
  if (evidence.status !== "resolved") {
    return Object.freeze({ ...state, state: "invalid", reason: evidence.reason ?? "resolution_unavailable_or_ambiguous" });
  }
  if (evidence.authority !== spec.resolution_authority || evidence.reference !== spec.resolution_reference) {
    return Object.freeze({ ...state, state: "invalid", reason: "resolution_authority_mismatch" });
  }
  if (!new Set(["YES", "NO"]).has(evidence.outcome)) return Object.freeze({ ...state, state: "invalid", reason: "ambiguous_resolution" });
  iso(evidence.retrieved_at_utc, "resolution retrieved_at_utc");
  assert(isSha256Hex(evidence.evidence_hash), "resolution evidence_hash must be SHA-256 hex");
  return Object.freeze({
    ...state,
    state: "resolved",
    outcome: evidence.outcome,
    authority_reference: evidence.reference,
    retrieved_at_utc: evidence.retrieved_at_utc,
    evidence_hash: evidence.evidence_hash,
    reason: "independent_official_resolution",
  });
}

export function classifyCryptoStructAccessFailure(code, { rateLimitPastCutoff = false } = {}) {
  const normalized = String(code ?? "").toUpperCase();
  if (normalized === "RATE_LIMITED" && !rateLimitPastCutoff) {
    return { fail_closed: true, state: "INELIGIBLE", reason: "rate_limited_primary_observation", owner_gate: false };
  }
  if (ACCESS_FAILURES.has(normalized)) {
    return { fail_closed: true, state: "PAUSE", reason: normalized.toLowerCase(), owner_gate: true };
  }
  return { fail_closed: true, state: "INELIGIBLE", reason: "source_error", owner_gate: false };
}

export function buildPrivateCryptoStructEvidenceEvent({ run_id, sequence, prev_record_hash, payload, recorded_at_utc }) {
  nonEmpty(run_id, "run_id");
  validatePrivateEvidencePayload(payload);
  return buildEvidenceRecord({
    run_id,
    sequence,
    event_type: "metric",
    recorded_at_utc,
    payload,
    prev_record_hash,
  });
}

export function validatePrivateEvidencePayload(payload) {
  closedKeys(payload, [
    "schema_version",
    "independent_event_id",
    "independent_event_spec_hash",
    "source_mapping_record_hash",
    "cryptostruct_instrument_id",
    "cryptostruct_code",
    "underlying_venue",
    "orientation",
    "category",
    "source_endpoint",
    "source_tool",
    "source_schema_fingerprint",
    "source_contract_hash",
    "scheduled_cutoff_utc",
    "request_start_utc",
    "request_complete_utc",
    "capture_timestamp_utc",
    "p_control",
    "trades_60m",
    "turnover_usd_60m",
    "spread_bps_60m_avg",
    "top1_depth_bid_usd_60m",
    "top1_depth_ask_usd_60m",
    "top1_depth_min_side_usd_60m",
    "eligibility",
    "rejection_reason",
    "response_content_hash",
    "frozen_deadline_utc",
    "official_outcome",
    "resolution_evidence_hash",
    "treatment_context_hash",
    "future_model_config_hash",
    "future_p_yes",
    "future_treatment_status",
    "future_latency_ms",
    "future_input_tokens",
    "future_output_tokens",
    "future_cost_usd",
  ], "CryptoStructPrivateEvidencePayload");
  assert(payload.schema_version === "cryptostruct-private-evidence.v1", "private evidence schema mismatch");
  nonEmpty(payload.independent_event_id, "independent_event_id");
  assert(isSha256Hex(payload.independent_event_spec_hash), "independent_event_spec_hash must be SHA-256 hex");
  assert(isSha256Hex(payload.source_mapping_record_hash), "source_mapping_record_hash must be SHA-256 hex");
  nonEmpty(payload.cryptostruct_instrument_id, "cryptostruct_instrument_id");
  nonEmpty(payload.cryptostruct_code, "cryptostruct_code");
  assert(payload.underlying_venue === CRYPTOSTRUCT_UNDERLYING_VENUE, "underlying_venue must be polymarket");
  assert(payload.orientation === "YES", "orientation must be YES");
  assert(PHASE0B_ALLOWED_CATEGORIES.includes(payload.category), "private evidence category not allowed");
  assert(payload.source_endpoint === CRYPTOSTRUCT_MCP_ENDPOINT, "source_endpoint mismatch");
  assert(CRYPTOSTRUCT_ALLOWED_TOOLS.includes(payload.source_tool), "source_tool not permitted");
  assert(isSha256Hex(payload.source_schema_fingerprint), "source_schema_fingerprint must be SHA-256 hex");
  assert(payload.source_contract_hash === cryptoStructSourceContractHash(), "source_contract_hash mismatch");
  for (const field of ["scheduled_cutoff_utc", "request_start_utc", "request_complete_utc", "capture_timestamp_utc", "frozen_deadline_utc"]) iso(payload[field], field);
  probability(payload.p_control, "p_control");
  integerAtLeast(payload.trades_60m, 0, "trades_60m");
  nonNegative(payload.turnover_usd_60m, "turnover_usd_60m");
  nonNegative(payload.spread_bps_60m_avg, "spread_bps_60m_avg");
  nonNegative(payload.top1_depth_bid_usd_60m, "top1_depth_bid_usd_60m");
  nonNegative(payload.top1_depth_ask_usd_60m, "top1_depth_ask_usd_60m");
  nonNegative(payload.top1_depth_min_side_usd_60m, "top1_depth_min_side_usd_60m");
  assert(
    payload.top1_depth_min_side_usd_60m === Math.min(payload.top1_depth_bid_usd_60m, payload.top1_depth_ask_usd_60m),
    "top1_depth_min_side_usd_60m must equal min(bid,ask)",
  );
  assert(typeof payload.eligibility === "boolean", "eligibility must be boolean");
  assert(
    payload.rejection_reason === null || CRYPTOSTRUCT_REJECTION_REASON_CODES.includes(payload.rejection_reason),
    "rejection_reason must be null or a canonical Release 0.5 reason code",
  );
  assert(payload.response_content_hash === null || isSha256Hex(payload.response_content_hash), "response_content_hash must be null/SHA-256");
  assert(payload.official_outcome === null || new Set(["YES", "NO"]).has(payload.official_outcome), "official_outcome must be null/YES/NO");
  assert(payload.resolution_evidence_hash === null || isSha256Hex(payload.resolution_evidence_hash), "resolution_evidence_hash must be null/SHA-256");
  assert(isSha256Hex(payload.treatment_context_hash), "treatment_context_hash must be SHA-256 hex");
  assert(payload.future_model_config_hash === null || isSha256Hex(payload.future_model_config_hash), "future_model_config_hash must be null/SHA-256");
  assert(payload.future_p_yes === null || (typeof payload.future_p_yes === "number" && Number.isFinite(payload.future_p_yes) && payload.future_p_yes >= 0.01 && payload.future_p_yes <= 0.99), "future_p_yes must be null or in [0.01,0.99]");
  assert(payload.future_treatment_status === null || typeof payload.future_treatment_status === "string", "future_treatment_status must be null/string");
  for (const field of ["future_latency_ms", "future_input_tokens", "future_output_tokens"]) {
    assert(payload[field] === null || (Number.isInteger(payload[field]) && payload[field] >= 0), `${field} must be null/non-negative integer`);
  }
  assert(payload.future_cost_usd === null || (typeof payload.future_cost_usd === "number" && Number.isFinite(payload.future_cost_usd) && payload.future_cost_usd >= 0), "future_cost_usd must be null/non-negative finite");
  return payload;
}

export function buildSanitizedPublicEvidence(
  privateEvents,
  { qualification, source_contract_hash, source_schema_fingerprint },
) {
  assert(Array.isArray(privateEvents), "privateEvents must be an array");
  assert(new Set(["QUALIFIED", "INSUFFICIENT", "BLOCKED"]).has(qualification), "qualification must be QUALIFIED/INSUFFICIENT/BLOCKED");
  assert(source_contract_hash === cryptoStructSourceContractHash(), "source_contract_hash mismatch");
  assert(isSha256Hex(source_schema_fingerprint), "source_schema_fingerprint must be SHA-256 hex");
  const rejection_reasons = {};
  const categories = {};
  let eligible = 0;
  for (const event of privateEvents) {
    const payload = event?.payload ?? event;
    validatePrivateEvidencePayload(payload);
    if (payload.eligibility) eligible += 1;
    else {
      assert(payload.rejection_reason !== null, "ineligible private evidence requires canonical rejection_reason");
      const reason = payload.rejection_reason;
      rejection_reasons[reason] = (rejection_reasons[reason] ?? 0) + 1;
    }
    const category = payload.category;
    if (category) categories[category] = (categories[category] ?? 0) + 1;
  }
  const publicEvidence = {
    schema_version: "cryptostruct-public-evidence.v1",
    provider: CRYPTOSTRUCT_PROVIDER,
    underlying_venue: CRYPTOSTRUCT_UNDERLYING_VENUE,
    sample_records: privateEvents.length,
    eligible_records: eligible,
    ineligible_records: privateEvents.length - eligible,
    rejection_reasons,
    category_counts: categories,
    source_schema_fingerprint,
    source_contract_hash,
    qualification,
    raw_responses_retained: false,
    reconstructive_dataset_retained: false,
  };
  assertPublicEvidenceSanitized(publicEvidence);
  return publicEvidence;
}

export function assertPublicEvidenceSanitized(value) {
  plain(value, "public evidence");
  plain(value.rejection_reasons, "public rejection_reasons");
  for (const reason of Object.keys(value.rejection_reasons)) {
    assert(CRYPTOSTRUCT_REJECTION_REASON_CODES.includes(reason), `public evidence contains non-canonical rejection reason: ${reason}`);
  }
  const serialized = canonicalSerialize(value);
  for (const field of PROHIBITED_PUBLIC_FIELDS) {
    assert(!serialized.includes(`\"${field}\"`), `public evidence leaks prohibited field: ${field}`);
  }
  return value;
}

export function estimateCohortThroughput({ candidate_events, eligible_unique_events, eligible_cutoff_decisions }) {
  integerAtLeast(candidate_events, 1, "candidate_events");
  integerAtLeast(eligible_unique_events, 0, "eligible_unique_events");
  integerAtLeast(eligible_cutoff_decisions, 0, "eligible_cutoff_decisions");
  assert(eligible_unique_events <= candidate_events, "eligible_unique_events cannot exceed candidate_events");
  assert(eligible_cutoff_decisions <= candidate_events * 3, "eligible_cutoff_decisions cannot exceed three cutoffs per candidate event");
  const scale = COHORT_FLOORS.max_selected_events / candidate_events;
  const projected_unique_resolved_events = Math.min(
    COHORT_FLOORS.max_selected_events,
    Math.floor(eligible_unique_events * scale),
  );
  const projected_paired_eligible_decisions = Math.min(
    COHORT_FLOORS.max_selected_events * 3,
    Math.floor(eligible_cutoff_decisions * scale),
  );
  const plausible = projected_unique_resolved_events >= COHORT_FLOORS.min_unique_resolved_events
    && projected_paired_eligible_decisions >= COHORT_FLOORS.min_paired_eligible_decisions;
  return {
    candidate_events,
    eligible_unique_events,
    eligible_cutoff_decisions,
    projected_unique_resolved_events,
    projected_paired_eligible_decisions,
    required_unique_resolved_events: COHORT_FLOORS.min_unique_resolved_events,
    required_paired_eligible_decisions: COHORT_FLOORS.min_paired_eligible_decisions,
    classification: plausible ? "PLAUSIBLE" : "DATA_INSUFFICIENT",
  };
}
