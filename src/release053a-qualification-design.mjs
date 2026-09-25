import { canonicalSerialize, isSha256Hex, sha256Hex } from "./canonical.mjs";
import {
  PHASE0B_ALLOWED_CATEGORIES,
  QUALITY_GATE,
  createSourceMappingRecord,
  cryptoStructSourceContractHash,
  independentEventSpecHash,
  sourceSchemaFingerprint,
  validateIndependentEventSpec,
  validateSourceMappingForSpec,
  validateSourceMappingRecord,
} from "./cryptostruct-source.mjs";

export const RELEASE053A_SCHEMA_DIAGNOSTIC_VERSION =
  "cryptostruct-schema-diagnostic.v1";
export const RELEASE053A_EVENT_FIRST_PLAN_VERSION =
  "cryptostruct-event-first-query-plan.v1";
export const RELEASE053A_SEMANTIC_BUNDLE_VERSION =
  "cryptostruct-event-first-semantic-bundle.v1";
export const RELEASE053A_QUALITY_FEASIBILITY_VERSION =
  "cryptostruct-quality-feasibility.v1";
export const RELEASE053A_NORMALIZATION_VERSION =
  "release-0.5.3-exact-normalized-alias.v1";
export const RELEASE053A_PARSER_DESCRIPTOR_VERSION =
  "release-0.5.3-current-strict-parser-shape.v1";

export const RELEASE053A_OFFLINE_RECOMMENDATION =
  "PROCEED_TO_0.5.3B_DESIGN_REVIEW";

const SCHEMA_MISMATCH_CATEGORIES = Object.freeze([
  "MISSING_EXPECTED_FIELD",
  "UNEXPECTED_EXTRA_FIELD",
  "WRONG_JSON_TYPE",
  "NESTED_SHAPE_MISMATCH",
]);

const QUALITY_REASON_CODES = Object.freeze([
  "low_trades_60m",
  "low_turnover_60m",
  "low_top1_depth",
  "invalid_or_wide_spread",
]);

const EVENT_FIRST_LIMITS = Object.freeze({
  max_search_calls: 8,
  search_limit: 10,
  max_get_instrument_calls: 40,
  max_snapshot_calls: 30,
  max_total_source_calls: 78,
  minimum_evaluable_snapshots: 30,
  minimum_unique_mapped_events: 30,
  per_event_snapshot_cap: 1,
});

const descriptor = (type, { required = [], properties = {} } = {}) =>
  Object.freeze({
    type,
    required: Object.freeze([...required]),
    properties: Object.freeze(structuredClone(properties)),
  });

const anyDescriptor = Object.freeze({ type: "any" });

const GET_MARKET_SNAPSHOT_DESCRIPTOR = descriptor("object", {
  required: [
    "instrument_id",
    "code",
    "venue",
    "as_of",
    "price_last",
    "last_60m",
  ],
  properties: {
    instrument_id: { type: "integer" },
    code: { type: "string" },
    venue: { type: "string" },
    as_of: { type: "string" },
    price_last: { type: "number" },
    change_24h_pct: anyDescriptor,
    vwap_last_minute: anyDescriptor,
    last_60m: descriptor("object", {
      required: [
        "turnover_usd",
        "trades",
        "spread_bps_avg",
        "top1_depth_usd",
      ],
      properties: {
        turnover_usd: { type: "number" },
        turnover_buy_usd: anyDescriptor,
        turnover_sell_usd: anyDescriptor,
        trades: { type: "integer" },
        liquidations: anyDescriptor,
        spread_bps_avg: { type: "number" },
        top1_depth_usd: descriptor("object", {
          required: ["bid", "ask"],
          properties: {
            bid: { type: "number" },
            ask: { type: "number" },
          },
        }),
        top20_depth_usd: anyDescriptor,
      },
    }),
    last_24h: anyDescriptor,
  },
});

const GET_INSTRUMENT_DESCRIPTOR = descriptor("object", {
  required: [
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
  ],
  properties: {
    instrument_id: { type: "integer" },
    code: { type: "string" },
    type: { type: "string" },
    venue: { type: "string" },
    venue_name: { type: "string" },
    base: { type: "string" },
    quote: { type: "string" },
    state: { type: "string" },
    days_with_data: { type: "integer" },
    first_day: { type: "string" },
    last_day: { type: "string" },
    total_bytes_compressed: { type: "integer" },
    listed_since: { type: "string" },
  },
});

const SEARCH_HIT_DESCRIPTOR = descriptor("object", {
  required: [
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
  ],
  properties: {
    instrument_id: { type: "integer" },
    code: { type: "string" },
    type: { type: "string" },
    venue: { type: "string" },
    venue_name: { type: "string" },
    base: { type: "string" },
    quote: { type: "string" },
    state: { type: "string" },
    days_with_data: { type: "integer" },
    first_day: { type: "string" },
    last_day: { type: "string" },
    total_bytes_compressed: { type: "integer" },
  },
});

const SEARCH_INSTRUMENTS_DESCRIPTOR = descriptor("object", {
  required: ["total_matching", "showing", "hits"],
  properties: {
    total_matching: { type: "integer" },
    showing: { type: "integer" },
    hits: { type: "array", item: SEARCH_HIT_DESCRIPTOR },
  },
});

export const RELEASE053A_TOOL_SCHEMA_DESCRIPTORS = Object.freeze({
  search_instruments: SEARCH_INSTRUMENTS_DESCRIPTOR,
  get_instrument: GET_INSTRUMENT_DESCRIPTOR,
  get_market_snapshot: GET_MARKET_SNAPSHOT_DESCRIPTOR,
});

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

function nonNegativeInteger(value, label) {
  assert(Number.isInteger(value) && value >= 0, `${label} must be a non-negative integer`);
  return value;
}

function positiveInteger(value, label) {
  assert(Number.isInteger(value) && value > 0, `${label} must be a positive integer`);
  return value;
}

function closedKeys(value, allowed, label) {
  plain(value, label);
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    assert(allowedSet.has(key), `${label} contains unknown field: ${key}`);
  }
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function jsonKind(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function typeMatches(value, expectedType) {
  if (expectedType === "any") return true;
  if (expectedType === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }
  if (expectedType === "integer") return Number.isInteger(value);
  if (expectedType === "object") {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  if (expectedType === "array") return Array.isArray(value);
  return typeof value === expectedType;
}

function keySetHash(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return sha256Hex(canonicalSerialize([]));
  }
  return sha256Hex(canonicalSerialize(Object.keys(value).sort()));
}

function descriptorMaterial(node) {
  if (!node || node.type === "any") return { type: "any" };
  const material = { type: node.type };
  if (Array.isArray(node.required)) material.required = [...node.required].sort();
  if (node.properties) {
    material.properties = Object.fromEntries(
      Object.keys(node.properties)
        .sort()
        .map((key) => [key, descriptorMaterial(node.properties[key])]),
    );
  }
  if (node.item) material.item = descriptorMaterial(node.item);
  return material;
}

export function release053ParserContractHash(tool) {
  const shape = RELEASE053A_TOOL_SCHEMA_DESCRIPTORS[tool];
  assert(shape, `unsupported parser diagnostic tool: ${tool}`);
  return sha256Hex(canonicalSerialize({
    descriptor_version: RELEASE053A_PARSER_DESCRIPTOR_VERSION,
    tool,
    shape: descriptorMaterial(shape),
  }));
}

function walkExpectedPaths(node, value, path, presence, nestedHashes, mismatches) {
  if (node.type === "any") {
    presence[path] = value === undefined ? "missing" : jsonKind(value);
    return;
  }

  if (value === undefined) {
    presence[path] = "missing";
    return;
  }

  const actualKind = jsonKind(value);
  presence[path] = actualKind;

  if (!typeMatches(value, node.type)) {
    mismatches.push({
      category: "WRONG_JSON_TYPE",
      path,
      expected_type: node.type,
      actual_type: actualKind,
    });
    return;
  }

  if (node.type === "array") {
    if (node.item && value.length > 0) {
      for (const item of value.slice(0, 10)) {
        walkExpectedPaths(node.item, item, `${path}[]`, presence, nestedHashes, mismatches);
      }
    }
    return;
  }

  if (node.type !== "object") return;

  const allowedKeys = Object.keys(node.properties ?? {}).sort();
  const actualKeys = Object.keys(value).sort();
  const expectedKeyHash = sha256Hex(canonicalSerialize(allowedKeys));
  const actualKeyHash = sha256Hex(canonicalSerialize(actualKeys));
  nestedHashes.push({
    path,
    expected_key_set_hash: expectedKeyHash,
    actual_key_set_hash: actualKeyHash,
    expected_key_count: allowedKeys.length,
    actual_key_count: actualKeys.length,
  });

  const missing = (node.required ?? []).filter(
    (key) => !Object.prototype.hasOwnProperty.call(value, key),
  );
  const extra = actualKeys.filter(
    (key) => !Object.prototype.hasOwnProperty.call(node.properties ?? {}, key),
  );

  if (path === "$") {
    for (const key of missing) {
      mismatches.push({
        category: "MISSING_EXPECTED_FIELD",
        path: `$.${key}`,
        expected_type: node.properties[key]?.type ?? "any",
        actual_type: "missing",
      });
    }
    if (extra.length > 0) {
      mismatches.push({
        category: "UNEXPECTED_EXTRA_FIELD",
        path: "$",
        expected_type: "closed_object",
        actual_type: "object",
      });
    }
  } else if (missing.length > 0 || extra.length > 0) {
    mismatches.push({
      category: "NESTED_SHAPE_MISMATCH",
      path,
      expected_type: "closed_object",
      actual_type: "object",
    });
  }

  for (const key of allowedKeys) {
    walkExpectedPaths(
      node.properties[key],
      value[key],
      `${path}.${key}`,
      presence,
      nestedHashes,
      mismatches,
    );
  }
}

function diagnosticMaterialWithoutHash(diagnostic) {
  const { diagnostic_hash: _diagnosticHash, ...material } = diagnostic;
  return material;
}

export function validateRelease053SchemaDiagnostic(diagnostic) {
  closedKeys(diagnostic, [
    "schema_version",
    "proof_run_id",
    "call_sequence",
    "terminal_reason_code",
    "tool",
    "source_contract_hash",
    "parser_descriptor_version",
    "parser_contract_hash",
    "source_schema_fingerprint",
    "actual_top_level_key_set_hash",
    "actual_top_level_key_count",
    "type_presence_map_hash",
    "mismatch_categories",
    "primary_category",
    "normalized_failing_paths",
    "missing_field_count",
    "extra_field_count",
    "wrong_type_count",
    "nested_shape_count",
    "nested_key_sets",
    "diagnostic_hash",
  ], "SchemaDiagnostic");
  assert(diagnostic.schema_version === RELEASE053A_SCHEMA_DIAGNOSTIC_VERSION, "SchemaDiagnostic schema_version mismatch");
  nonEmpty(diagnostic.proof_run_id, "SchemaDiagnostic proof_run_id");
  positiveInteger(diagnostic.call_sequence, "SchemaDiagnostic call_sequence");
  assert(diagnostic.terminal_reason_code === "source_contract_parse_error", "SchemaDiagnostic terminal_reason_code mismatch");
  assert(Object.hasOwn(RELEASE053A_TOOL_SCHEMA_DESCRIPTORS, diagnostic.tool), "SchemaDiagnostic tool unsupported");
  for (const field of [
    "source_contract_hash",
    "parser_contract_hash",
    "source_schema_fingerprint",
    "actual_top_level_key_set_hash",
    "type_presence_map_hash",
    "diagnostic_hash",
  ]) {
    assert(isSha256Hex(diagnostic[field]), `SchemaDiagnostic ${field} must be SHA-256 hex`);
  }
  assert(
    diagnostic.parser_descriptor_version === RELEASE053A_PARSER_DESCRIPTOR_VERSION,
    "SchemaDiagnostic parser_descriptor_version mismatch",
  );
  nonNegativeInteger(diagnostic.actual_top_level_key_count, "SchemaDiagnostic actual_top_level_key_count");
  assert(Array.isArray(diagnostic.mismatch_categories) && diagnostic.mismatch_categories.length > 0, "SchemaDiagnostic mismatch_categories required");
  assert(
    diagnostic.mismatch_categories.every((category) => SCHEMA_MISMATCH_CATEGORIES.includes(category)),
    "SchemaDiagnostic mismatch category unsupported",
  );
  assert(
    diagnostic.primary_category === diagnostic.mismatch_categories[0],
    "SchemaDiagnostic primary_category must be first mismatch category",
  );
  assert(Array.isArray(diagnostic.normalized_failing_paths), "SchemaDiagnostic normalized_failing_paths must be array");
  assert(diagnostic.normalized_failing_paths.length <= 8, "SchemaDiagnostic failing paths exceed bounded maximum");
  for (const path of diagnostic.normalized_failing_paths) nonEmpty(path, "SchemaDiagnostic failing path");
  for (const field of [
    "missing_field_count",
    "extra_field_count",
    "wrong_type_count",
    "nested_shape_count",
  ]) {
    nonNegativeInteger(diagnostic[field], `SchemaDiagnostic ${field}`);
  }
  assert(Array.isArray(diagnostic.nested_key_sets), "SchemaDiagnostic nested_key_sets must be array");
  assert(diagnostic.nested_key_sets.length <= 8, "SchemaDiagnostic nested_key_sets exceed bounded maximum");
  for (const item of diagnostic.nested_key_sets) {
    closedKeys(item, [
      "path",
      "expected_key_set_hash",
      "actual_key_set_hash",
      "expected_key_count",
      "actual_key_count",
    ], "SchemaDiagnostic nested_key_set");
    nonEmpty(item.path, "SchemaDiagnostic nested_key_set path");
    assert(isSha256Hex(item.expected_key_set_hash), "SchemaDiagnostic expected_key_set_hash invalid");
    assert(isSha256Hex(item.actual_key_set_hash), "SchemaDiagnostic actual_key_set_hash invalid");
    nonNegativeInteger(item.expected_key_count, "SchemaDiagnostic expected_key_count");
    nonNegativeInteger(item.actual_key_count, "SchemaDiagnostic actual_key_count");
  }
  assert(
    diagnostic.diagnostic_hash
      === sha256Hex(canonicalSerialize(diagnosticMaterialWithoutHash(diagnostic))),
    "SchemaDiagnostic diagnostic_hash mismatch",
  );
  return diagnostic;
}

export function diagnoseRelease053ToolSchema({
  tool,
  actualPayload,
  proofRunId,
  callSequence,
}) {
  nonEmpty(proofRunId, "schema diagnostic proofRunId");
  positiveInteger(callSequence, "schema diagnostic callSequence");
  const shape = RELEASE053A_TOOL_SCHEMA_DESCRIPTORS[tool];
  assert(shape, `unsupported parser diagnostic tool: ${tool}`);

  const presence = {};
  const nestedKeySets = [];
  const mismatches = [];
  walkExpectedPaths(shape, actualPayload, "$", presence, nestedKeySets, mismatches);

  if (mismatches.length === 0) return null;

  const categories = [];
  for (const category of SCHEMA_MISMATCH_CATEGORIES) {
    if (mismatches.some((item) => item.category === category)) categories.push(category);
  }

  const failingPaths = [...new Set(mismatches.map((item) => item.path))]
    .sort()
    .slice(0, 8);
  const counts = Object.fromEntries(
    SCHEMA_MISMATCH_CATEGORIES.map((category) => [
      category,
      mismatches.filter((item) => item.category === category).length,
    ]),
  );

  const material = {
    schema_version: RELEASE053A_SCHEMA_DIAGNOSTIC_VERSION,
    proof_run_id: proofRunId,
    call_sequence: callSequence,
    terminal_reason_code: "source_contract_parse_error",
    tool,
    source_contract_hash: cryptoStructSourceContractHash(),
    parser_descriptor_version: RELEASE053A_PARSER_DESCRIPTOR_VERSION,
    parser_contract_hash: release053ParserContractHash(tool),
    source_schema_fingerprint: sourceSchemaFingerprint(actualPayload),
    actual_top_level_key_set_hash: keySetHash(actualPayload),
    actual_top_level_key_count:
      actualPayload && typeof actualPayload === "object" && !Array.isArray(actualPayload)
        ? Object.keys(actualPayload).length
        : 0,
    type_presence_map_hash: sha256Hex(canonicalSerialize(presence)),
    mismatch_categories: categories,
    primary_category: categories[0],
    normalized_failing_paths: failingPaths,
    missing_field_count: counts.MISSING_EXPECTED_FIELD,
    extra_field_count: counts.UNEXPECTED_EXTRA_FIELD,
    wrong_type_count: counts.WRONG_JSON_TYPE,
    nested_shape_count: counts.NESTED_SHAPE_MISMATCH,
    nested_key_sets: nestedKeySets.slice(0, 8),
  };
  const diagnostic = {
    ...material,
    diagnostic_hash: sha256Hex(canonicalSerialize(material)),
  };
  validateRelease053SchemaDiagnostic(diagnostic);
  return deepFreeze(diagnostic);
}

export function normalizeRelease053SemanticKey(value) {
  return nonEmpty(value, "semantic value")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/gu, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function validateIndependentEventPlanEntry(entry) {
  closedKeys(entry, ["spec", "query_terms", "semantic_aliases"], "EventFirstPlan entry");
  validateIndependentEventSpec(entry.spec);
  assert(Array.isArray(entry.query_terms) && entry.query_terms.length > 0, "EventFirstPlan query_terms required");
  assert(Array.isArray(entry.semantic_aliases) && entry.semantic_aliases.length > 0, "EventFirstPlan semantic_aliases required");

  const normalizedTerms = entry.query_terms.map((term) => normalizeRelease053SemanticKey(term));
  const normalizedAliases = entry.semantic_aliases.map((alias) => normalizeRelease053SemanticKey(alias));
  assert(new Set(normalizedTerms).size === normalizedTerms.length, "EventFirstPlan duplicate normalized query term");
  assert(new Set(normalizedAliases).size === normalizedAliases.length, "EventFirstPlan duplicate normalized semantic alias");
  return entry;
}

function eventFirstEvents(entries) {
  assert(Array.isArray(entries) && entries.length > 0, "EventFirstPlan entries required");
  const eventIds = new Set();
  const hashes = new Set();
  const events = entries.map((entry) => {
    validateIndependentEventPlanEntry(entry);
    assert(!eventIds.has(entry.spec.event_id), "EventFirstPlan duplicate event_id");
    eventIds.add(entry.spec.event_id);
    const specHash = independentEventSpecHash(entry.spec);
    assert(!hashes.has(specHash), "EventFirstPlan duplicate IndependentEventSpec");
    hashes.add(specHash);
    return {
      event_id: entry.spec.event_id,
      independent_event_spec_hash: specHash,
      spec: structuredClone(entry.spec),
      query_terms: entry.query_terms.map((term) => nonEmpty(term, "query term")),
      semantic_aliases: entry.semantic_aliases.map((alias) => nonEmpty(alias, "semantic alias")),
    };
  });
  events.sort((left, right) => left.event_id.localeCompare(right.event_id));
  return events;
}

function uniqueSearchTerms(events) {
  const byNormalized = new Map();
  for (const event of events) {
    event.query_terms.forEach((query, queryIndex) => {
      const normalized = normalizeRelease053SemanticKey(query);
      if (!byNormalized.has(normalized)) {
        byNormalized.set(normalized, {
          q: query,
          normalized_q: normalized,
          first_event_id: event.event_id,
          first_query_index: queryIndex,
          source_event_ids: [event.event_id],
        });
      } else {
        const existing = byNormalized.get(normalized);
        if (!existing.source_event_ids.includes(event.event_id)) {
          existing.source_event_ids.push(event.event_id);
        }
      }
    });
  }
  return [...byNormalized.values()];
}

export function createRelease053EventFirstQueryPlan(entries) {
  const events = eventFirstEvents(entries);
  const searchTerms = uniqueSearchTerms(events);
  assert(
    searchTerms.length <= EVENT_FIRST_LIMITS.max_search_calls,
    `EventFirstPlan requires ${searchTerms.length} search calls; maximum is ${EVENT_FIRST_LIMITS.max_search_calls}`,
  );

  const plan = {
    schema_version: RELEASE053A_EVENT_FIRST_PLAN_VERSION,
    derivation_contract: "independent-spec-authored-before-provider-access",
    normalization_version: RELEASE053A_NORMALIZATION_VERSION,
    source_contract_hash: cryptoStructSourceContractHash(),
    search_defaults: {
      class: "prediction",
      venue: "polymarket",
      limit: EVENT_FIRST_LIMITS.search_limit,
    },
    events,
    candidate_selection: {
      event_order: "event_id_asc",
      query_order: "first_declared_occurrence",
      hit_order: "provider_order",
      dedupe_key: "instrument_id_first_occurrence",
      max_search_calls: EVENT_FIRST_LIMITS.max_search_calls,
      max_get_instrument_calls: EVENT_FIRST_LIMITS.max_get_instrument_calls,
      max_snapshot_calls: EVENT_FIRST_LIMITS.max_snapshot_calls,
      max_total_source_calls: EVENT_FIRST_LIMITS.max_total_source_calls,
      per_event_snapshot_cap: EVENT_FIRST_LIMITS.per_event_snapshot_cap,
      retry: false,
      no_match: "semantic_mapping_unproven",
      ambiguous_match: "semantic_mapping_unproven",
    },
  };
  validateRelease053EventFirstQueryPlan(plan);
  return deepFreeze(plan);
}

export function validateRelease053EventFirstQueryPlan(plan) {
  closedKeys(plan, [
    "schema_version",
    "derivation_contract",
    "normalization_version",
    "source_contract_hash",
    "search_defaults",
    "events",
    "candidate_selection",
  ], "EventFirstQueryPlan");
  assert(plan.schema_version === RELEASE053A_EVENT_FIRST_PLAN_VERSION, "EventFirstQueryPlan schema_version mismatch");
  assert(plan.derivation_contract === "independent-spec-authored-before-provider-access", "EventFirstQueryPlan derivation contract mismatch");
  assert(plan.normalization_version === RELEASE053A_NORMALIZATION_VERSION, "EventFirstQueryPlan normalization version mismatch");
  assert(plan.source_contract_hash === cryptoStructSourceContractHash(), "EventFirstQueryPlan source contract mismatch");

  closedKeys(plan.search_defaults, ["class", "venue", "limit"], "EventFirstQueryPlan search_defaults");
  assert(plan.search_defaults.class === "prediction", "EventFirstQueryPlan class must be prediction");
  assert(plan.search_defaults.venue === "polymarket", "EventFirstQueryPlan venue must be polymarket");
  assert(plan.search_defaults.limit === EVENT_FIRST_LIMITS.search_limit, "EventFirstQueryPlan search limit mismatch");

  assert(Array.isArray(plan.events) && plan.events.length > 0, "EventFirstQueryPlan events required");
  const ids = plan.events.map((event) => event.event_id);
  assert(canonicalSerialize(ids) === canonicalSerialize([...ids].sort()), "EventFirstQueryPlan events must be event_id sorted");
  for (const event of plan.events) {
    closedKeys(event, [
      "event_id",
      "independent_event_spec_hash",
      "spec",
      "query_terms",
      "semantic_aliases",
    ], "EventFirstQueryPlan event");
    validateIndependentEventSpec(event.spec);
    assert(event.event_id === event.spec.event_id, "EventFirstQueryPlan event_id/spec mismatch");
    assert(event.independent_event_spec_hash === independentEventSpecHash(event.spec), "EventFirstQueryPlan spec hash mismatch");
    assert(Array.isArray(event.query_terms) && event.query_terms.length > 0, "EventFirstQueryPlan event query_terms required");
    assert(Array.isArray(event.semantic_aliases) && event.semantic_aliases.length > 0, "EventFirstQueryPlan event semantic_aliases required");
  }

  closedKeys(plan.candidate_selection, [
    "event_order",
    "query_order",
    "hit_order",
    "dedupe_key",
    "max_search_calls",
    "max_get_instrument_calls",
    "max_snapshot_calls",
    "max_total_source_calls",
    "per_event_snapshot_cap",
    "retry",
    "no_match",
    "ambiguous_match",
  ], "EventFirstQueryPlan candidate_selection");
  for (const field of [
    "max_search_calls",
    "max_get_instrument_calls",
    "max_snapshot_calls",
    "max_total_source_calls",
    "per_event_snapshot_cap",
  ]) positiveInteger(plan.candidate_selection[field], `EventFirstQueryPlan ${field}`);
  assert(plan.candidate_selection.event_order === "event_id_asc", "EventFirstQueryPlan event_order mismatch");
  assert(plan.candidate_selection.query_order === "first_declared_occurrence", "EventFirstQueryPlan query_order mismatch");
  assert(plan.candidate_selection.hit_order === "provider_order", "EventFirstQueryPlan hit_order mismatch");
  assert(plan.candidate_selection.dedupe_key === "instrument_id_first_occurrence", "EventFirstQueryPlan dedupe_key mismatch");
  assert(plan.candidate_selection.max_search_calls === EVENT_FIRST_LIMITS.max_search_calls, "EventFirstQueryPlan max_search_calls mismatch");
  assert(plan.candidate_selection.max_get_instrument_calls === EVENT_FIRST_LIMITS.max_get_instrument_calls, "EventFirstQueryPlan max_get_instrument_calls mismatch");
  assert(plan.candidate_selection.max_snapshot_calls === EVENT_FIRST_LIMITS.max_snapshot_calls, "EventFirstQueryPlan max_snapshot_calls mismatch");
  assert(plan.candidate_selection.max_total_source_calls === EVENT_FIRST_LIMITS.max_total_source_calls, "EventFirstQueryPlan max_total_source_calls mismatch");
  assert(plan.candidate_selection.per_event_snapshot_cap === EVENT_FIRST_LIMITS.per_event_snapshot_cap, "EventFirstQueryPlan per_event_snapshot_cap mismatch");
  assert(plan.candidate_selection.retry === false, "EventFirstQueryPlan retry must be false");
  assert(plan.candidate_selection.no_match === "semantic_mapping_unproven", "EventFirstQueryPlan no_match mismatch");
  assert(plan.candidate_selection.ambiguous_match === "semantic_mapping_unproven", "EventFirstQueryPlan ambiguous_match mismatch");
  assert(
    uniqueSearchTerms(plan.events).length <= plan.candidate_selection.max_search_calls,
    "EventFirstQueryPlan search-call budget exceeded",
  );
  return plan;
}

export function release053EventFirstQueryPlanHash(plan) {
  validateRelease053EventFirstQueryPlan(plan);
  return sha256Hex(canonicalSerialize(plan));
}

export function release053EventFirstSemanticBundle(plan) {
  validateRelease053EventFirstQueryPlan(plan);
  const bundle = {
    schema_version: RELEASE053A_SEMANTIC_BUNDLE_VERSION,
    normalization_version: RELEASE053A_NORMALIZATION_VERSION,
    events: plan.events.map((event) => ({
      spec: structuredClone(event.spec),
      semantic_aliases: [...event.semantic_aliases],
    })),
  };
  return deepFreeze(bundle);
}

export function release053EventFirstSemanticBundleHash(plan) {
  return sha256Hex(canonicalSerialize(release053EventFirstSemanticBundle(plan)));
}

export function release053EventFirstSearchCalls(plan) {
  validateRelease053EventFirstQueryPlan(plan);
  return deepFreeze(
    uniqueSearchTerms(plan.events).map((term) => ({
      q: term.q,
      class: plan.search_defaults.class,
      venue: plan.search_defaults.venue,
      limit: plan.search_defaults.limit,
    })),
  );
}

function matchingEventsForCode(plan, code) {
  const key = normalizeRelease053SemanticKey(code);
  const matches = [];
  for (const event of plan.events) {
    if (event.semantic_aliases.some(
      (alias) => normalizeRelease053SemanticKey(alias) === key,
    )) {
      matches.push(event);
    }
  }
  return matches;
}

export function mapRelease053EventFirstInstrument({
  plan,
  instrument,
  mappingTimestamp,
}) {
  validateRelease053EventFirstQueryPlan(plan);
  const matches = matchingEventsForCode(plan, instrument.code);
  if (matches.length !== 1) {
    return deepFreeze({
      status: "semantic_mapping_unproven",
      match_count: matches.length,
      category: null,
    });
  }

  const match = matches[0];
  const semanticBundleHash = release053EventFirstSemanticBundleHash(plan);
  const normalizedCode = normalizeRelease053SemanticKey(instrument.code);
  const mappingEvidenceHash = sha256Hex(canonicalSerialize({
    normalization_version: RELEASE053A_NORMALIZATION_VERSION,
    semantic_bundle_hash: semanticBundleHash,
    independent_event_spec_hash: match.independent_event_spec_hash,
    normalized_match_key_hash: sha256Hex(normalizedCode),
  }));

  const record = createSourceMappingRecord({
    independent_event_spec_hash: match.independent_event_spec_hash,
    cryptostruct_instrument_id: instrument.instrument_id,
    cryptostruct_code: instrument.code,
    venue: instrument.venue,
    type: instrument.instrument_class,
    mapping_review_timestamp: mappingTimestamp,
    mapping_evidence_hash: mappingEvidenceHash,
    mapping_status: "VERIFIED",
  });
  validateSourceMappingRecord(record);
  const validation = validateSourceMappingForSpec({
    spec: match.spec,
    instrument,
    mapping_record: record,
  });
  if (!validation.valid) {
    return deepFreeze({
      status: "semantic_mapping_unproven",
      match_count: 1,
      category: null,
    });
  }

  return deepFreeze({
    status: "VERIFIED",
    match_count: 1,
    event_id: match.event_id,
    category: match.spec.category,
    independent_event_spec_hash: match.independent_event_spec_hash,
    source_mapping_record_hash: validation.source_mapping_record_hash,
    mapping_evidence_hash: mappingEvidenceHash,
  });
}

export function selectRelease053EventFirstSemanticCandidates({
  plan,
  discoveryResults,
}) {
  validateRelease053EventFirstQueryPlan(plan);
  const searchCalls = release053EventFirstSearchCalls(plan);
  assert(Array.isArray(discoveryResults), "discoveryResults must be an array");
  assert(discoveryResults.length === searchCalls.length, "discoveryResults/search plan length mismatch");

  const selected = [];
  const seenInstrumentIds = new Set();
  const seenEventIds = new Set();
  let noMatchCount = 0;
  let ambiguousMatchCount = 0;

  for (let queryIndex = 0; queryIndex < discoveryResults.length; queryIndex += 1) {
    const result = discoveryResults[queryIndex];
    if (result?.terminal_status !== "SUCCESS") continue;
    const instruments = result?.parsed?.instruments;
    if (!Array.isArray(instruments)) continue;

    for (let hitIndex = 0; hitIndex < instruments.length; hitIndex += 1) {
      const instrument = instruments[hitIndex];
      if (
        instrument?.venue !== "polymarket"
        || instrument?.instrument_class !== "prediction"
        || instrument?.state !== "open"
      ) continue;

      const instrumentId = String(instrument.instrument_id);
      if (seenInstrumentIds.has(instrumentId)) continue;
      seenInstrumentIds.add(instrumentId);

      const matches = matchingEventsForCode(plan, instrument.code);
      if (matches.length === 0) {
        noMatchCount += 1;
        continue;
      }
      if (matches.length !== 1) {
        ambiguousMatchCount += 1;
        continue;
      }
      const match = matches[0];
      if (seenEventIds.has(match.event_id)) continue;
      seenEventIds.add(match.event_id);
      selected.push({
        event_id: match.event_id,
        instrument_id: instrumentId,
        query_index: queryIndex,
        hit_index: hitIndex,
      });
      if (selected.length >= EVENT_FIRST_LIMITS.max_get_instrument_calls) break;
    }
    if (selected.length >= EVENT_FIRST_LIMITS.max_get_instrument_calls) break;
  }

  return deepFreeze({
    selected,
    no_match_count: noMatchCount,
    ambiguous_match_count: ambiguousMatchCount,
  });
}

export function selectRelease053SnapshotSample(verifiedCandidates) {
  assert(Array.isArray(verifiedCandidates), "verifiedCandidates must be an array");
  const selected = [];
  const seenEventIds = new Set();

  for (const candidate of verifiedCandidates) {
    plain(candidate, "verified candidate");
    assert(candidate.status === "VERIFIED", "snapshot sample requires VERIFIED candidates only");
    nonEmpty(candidate.event_id, "verified candidate event_id");
    nonEmpty(String(candidate.instrument_id), "verified candidate instrument_id");
    if (seenEventIds.has(candidate.event_id)) continue;
    seenEventIds.add(candidate.event_id);
    selected.push({
      event_id: candidate.event_id,
      instrument_id: String(candidate.instrument_id),
    });
    if (selected.length >= EVENT_FIRST_LIMITS.max_snapshot_calls) break;
  }

  return deepFreeze(selected);
}

export function release053QualityFeasibilityDesign() {
  const design = {
    schema_version: RELEASE053A_QUALITY_FEASIBILITY_VERSION,
    source_contract_hash: cryptoStructSourceContractHash(),
    screen_type: "NON_INFERENTIAL_DETERMINISTIC_ENGINEERING_SCREEN",
    quality_thresholds: {
      trades_60m_min: QUALITY_GATE.min_trades_60m,
      turnover_usd_60m_min: QUALITY_GATE.min_turnover_usd_60m,
      spread_bps_60m_avg_max: QUALITY_GATE.max_spread_bps_60m_avg,
      top1_depth_min_side_usd_60m_min: QUALITY_GATE.min_top1_depth_min_side_usd_60m,
    },
    sample: {
      maximum_search_calls: EVENT_FIRST_LIMITS.max_search_calls,
      maximum_get_instrument_calls: EVENT_FIRST_LIMITS.max_get_instrument_calls,
      maximum_snapshot_calls: EVENT_FIRST_LIMITS.max_snapshot_calls,
      maximum_total_source_calls: EVENT_FIRST_LIMITS.max_total_source_calls,
      minimum_evaluable_snapshots: EVENT_FIRST_LIMITS.minimum_evaluable_snapshots,
      minimum_unique_mapped_events: EVENT_FIRST_LIMITS.minimum_unique_mapped_events,
      per_event_snapshot_cap: EVENT_FIRST_LIMITS.per_event_snapshot_cap,
      no_retry: true,
      deterministic_order_only: true,
    },
    rationale: {
      evidence_basis: [
        "materially_broader_than_release052_six_evaluable_snapshots",
        "thirty_independently_specified_unique_events",
        "bounded_at_seventy_eight_data_returning_calls",
        "strict_thirty_of_thirty_engineering_go_no_go_screen",
      ],
      positive_result_meaning:
        "30 deterministically selected, independently specified event mappings each produced one parseable snapshot that passed every frozen source-quality threshold during the bounded qualification run.",
      unestablished: [
        "statistical_representativeness",
        "future_source_quality_probability",
        "cross_event_independence",
        "t24_t6_t1_temporal_stability",
        "later_category_robustness",
        "later_100_event_300_decision_cohort_floors",
      ],
    },
    classifications: {
      blocked: [
        "pre_dispatch_config_or_hash_mismatch",
        "source_transport_or_access_failure",
        "source_contract_parse_failure",
        "attempt_accounting_or_budget_failure",
        "retry_or_non_frozen_execution_path",
      ],
      insufficient: [
        "first_quality_reject_stops_screen_immediately",
        "deterministic_plan_exhausted_before_30_verified_unique_events",
        "fewer_than_30_evaluable_snapshots_without_source_failure",
      ],
      technically_viable: [
        "30_verified_unique_events",
        "exactly_30_evaluable_snapshots",
        "exactly_30_quality_passes",
        "zero_quality_rejects",
        "zero_source_or_parser_failures",
        "zero_retries",
      ],
    },
  };
  validateRelease053QualityFeasibilityDesign(design);
  return deepFreeze(design);
}

export function validateRelease053QualityFeasibilityDesign(design) {
  closedKeys(design, [
    "schema_version",
    "source_contract_hash",
    "screen_type",
    "quality_thresholds",
    "sample",
    "rationale",
    "classifications",
  ], "QualityFeasibilityDesign");
  assert(design.schema_version === RELEASE053A_QUALITY_FEASIBILITY_VERSION, "QualityFeasibilityDesign schema_version mismatch");
  assert(design.source_contract_hash === cryptoStructSourceContractHash(), "QualityFeasibilityDesign source contract mismatch");
  assert(
    design.screen_type === "NON_INFERENTIAL_DETERMINISTIC_ENGINEERING_SCREEN",
    "QualityFeasibilityDesign screen_type mismatch",
  );

  closedKeys(design.quality_thresholds, [
    "trades_60m_min",
    "turnover_usd_60m_min",
    "spread_bps_60m_avg_max",
    "top1_depth_min_side_usd_60m_min",
  ], "QualityFeasibilityDesign quality_thresholds");
  assert(design.quality_thresholds.trades_60m_min === 5, "quality trades threshold changed");
  assert(design.quality_thresholds.turnover_usd_60m_min === 100, "quality turnover threshold changed");
  assert(design.quality_thresholds.spread_bps_60m_avg_max === 2000, "quality spread threshold changed");
  assert(design.quality_thresholds.top1_depth_min_side_usd_60m_min === 50, "quality depth threshold changed");

  closedKeys(design.sample, [
    "maximum_search_calls",
    "maximum_get_instrument_calls",
    "maximum_snapshot_calls",
    "maximum_total_source_calls",
    "minimum_evaluable_snapshots",
    "minimum_unique_mapped_events",
    "per_event_snapshot_cap",
    "no_retry",
    "deterministic_order_only",
  ], "QualityFeasibilityDesign sample");
  for (const field of [
    "maximum_search_calls",
    "maximum_get_instrument_calls",
    "maximum_snapshot_calls",
    "maximum_total_source_calls",
    "minimum_evaluable_snapshots",
    "minimum_unique_mapped_events",
    "per_event_snapshot_cap",
  ]) positiveInteger(design.sample[field], `QualityFeasibilityDesign ${field}`);
  assert(
    design.sample.maximum_total_source_calls
      === design.sample.maximum_search_calls
        + design.sample.maximum_get_instrument_calls
        + design.sample.maximum_snapshot_calls,
    "QualityFeasibilityDesign total source-call budget mismatch",
  );
  assert(design.sample.maximum_search_calls === 8, "QualityFeasibilityDesign search-call ceiling changed");
  assert(design.sample.maximum_get_instrument_calls === 40, "QualityFeasibilityDesign instrument-call ceiling changed");
  assert(design.sample.maximum_snapshot_calls === 30, "QualityFeasibilityDesign snapshot-call ceiling changed");
  assert(design.sample.maximum_total_source_calls === 78, "QualityFeasibilityDesign total source-call ceiling changed");
  assert(design.sample.no_retry === true, "QualityFeasibilityDesign must forbid retries");
  assert(design.sample.deterministic_order_only === true, "QualityFeasibilityDesign order must be deterministic");
  assert(design.sample.minimum_evaluable_snapshots === 30, "QualityFeasibilityDesign minimum evaluable sample changed");
  assert(design.sample.minimum_unique_mapped_events === 30, "QualityFeasibilityDesign unique mapped-event minimum changed");
  assert(design.sample.per_event_snapshot_cap === 1, "QualityFeasibilityDesign per-event snapshot cap changed");

  closedKeys(design.rationale, [
    "evidence_basis",
    "positive_result_meaning",
    "unestablished",
  ], "QualityFeasibilityDesign rationale");
  assert(Array.isArray(design.rationale.evidence_basis) && design.rationale.evidence_basis.length === 4, "QualityFeasibilityDesign evidence_basis mismatch");
  nonEmpty(design.rationale.positive_result_meaning, "QualityFeasibilityDesign positive_result_meaning");
  assert(Array.isArray(design.rationale.unestablished) && design.rationale.unestablished.length >= 6, "QualityFeasibilityDesign unestablished list incomplete");
  for (const required of [
    "statistical_representativeness",
    "future_source_quality_probability",
    "cross_event_independence",
    "t24_t6_t1_temporal_stability",
    "later_category_robustness",
    "later_100_event_300_decision_cohort_floors",
  ]) {
    assert(design.rationale.unestablished.includes(required), `QualityFeasibilityDesign must mark ${required} unestablished`);
  }

  closedKeys(design.classifications, [
    "blocked",
    "insufficient",
    "technically_viable",
  ], "QualityFeasibilityDesign classifications");
  for (const value of Object.values(design.classifications)) {
    assert(Array.isArray(value) && value.length > 0, "QualityFeasibilityDesign classification clauses required");
  }
  return design;
}

export function release053QualityFeasibilityDesignHash() {
  return sha256Hex(canonicalSerialize(release053QualityFeasibilityDesign()));
}

export function validateRelease053FutureObservation(observation) {
  closedKeys(observation, [
    "pre_dispatch_valid",
    "source_failure_count",
    "parser_failure_count",
    "accounting_failure_count",
    "plan_exhausted",
    "verified_unique_events",
    "evaluable_snapshots",
    "quality_passes",
    "quality_rejects",
    "retry_count",
  ], "FutureObservation");

  for (const field of [
    "source_failure_count",
    "parser_failure_count",
    "accounting_failure_count",
    "verified_unique_events",
    "evaluable_snapshots",
    "quality_passes",
    "quality_rejects",
    "retry_count",
  ]) nonNegativeInteger(observation[field], `FutureObservation ${field}`);
  assert(typeof observation.pre_dispatch_valid === "boolean", "FutureObservation pre_dispatch_valid must be boolean");
  assert(typeof observation.plan_exhausted === "boolean", "FutureObservation plan_exhausted must be boolean");
  assert(
    observation.quality_passes + observation.quality_rejects
      === observation.evaluable_snapshots,
    "FutureObservation quality accounting mismatch",
  );
  assert(
    observation.evaluable_snapshots <= observation.verified_unique_events,
    "FutureObservation evaluable snapshots exceed verified unique events",
  );
  assert(
    observation.evaluable_snapshots <= EVENT_FIRST_LIMITS.max_snapshot_calls,
    "FutureObservation evaluable snapshots exceed frozen snapshot ceiling",
  );
  return observation;
}

export function classifyRelease053FutureObservation(observation) {
  validateRelease053FutureObservation(observation);

  if (
    !observation.pre_dispatch_valid
    || observation.source_failure_count > 0
    || observation.parser_failure_count > 0
    || observation.accounting_failure_count > 0
    || observation.retry_count > 0
  ) return "BLOCKED";

  if (observation.quality_rejects > 0) return "INSUFFICIENT";

  if (
    observation.verified_unique_events >= EVENT_FIRST_LIMITS.minimum_unique_mapped_events
    && observation.evaluable_snapshots === EVENT_FIRST_LIMITS.minimum_evaluable_snapshots
    && observation.quality_passes === EVENT_FIRST_LIMITS.minimum_evaluable_snapshots
    && observation.quality_rejects === 0
  ) return "TECHNICALLY_VIABLE";

  if (observation.plan_exhausted) return "INSUFFICIENT";
  return "CONTINUE_DETERMINISTIC_PLAN";
}

export function selectRelease053NextSnapshotCandidate({
  observation,
  verifiedCandidates,
  sampledEventIds = [],
}) {
  const classification = classifyRelease053FutureObservation(observation);
  if (classification !== "CONTINUE_DETERMINISTIC_PLAN") return null;

  assert(Array.isArray(verifiedCandidates), "verifiedCandidates must be an array");
  assert(Array.isArray(sampledEventIds), "sampledEventIds must be an array");
  const sampled = new Set(sampledEventIds);

  for (const candidate of verifiedCandidates) {
    plain(candidate, "verified candidate");
    assert(candidate.status === "VERIFIED", "next snapshot candidate must be VERIFIED");
    nonEmpty(candidate.event_id, "next snapshot candidate event_id");
    nonEmpty(String(candidate.instrument_id), "next snapshot candidate instrument_id");
    if (sampled.has(candidate.event_id)) continue;
    return deepFreeze({
      event_id: candidate.event_id,
      instrument_id: String(candidate.instrument_id),
    });
  }
  return null;
}

export function release053SnapshotQuality(snapshot) {
  const reasons = [];
  if (snapshot.trades_60m < QUALITY_GATE.min_trades_60m) reasons.push("low_trades_60m");
  if (snapshot.turnover_usd_60m < QUALITY_GATE.min_turnover_usd_60m) reasons.push("low_turnover_60m");
  if (snapshot.top1_depth_min_side_usd_60m < QUALITY_GATE.min_top1_depth_min_side_usd_60m) reasons.push("low_top1_depth");
  if (snapshot.spread_bps_60m_avg > QUALITY_GATE.max_spread_bps_60m_avg) reasons.push("invalid_or_wide_spread");
  assert(reasons.every((reason) => QUALITY_REASON_CODES.includes(reason)), "unsupported quality rejection reason");
  return deepFreeze({
    pass: reasons.length === 0,
    reasons,
  });
}

export function release053AFeasibilityDecision() {
  const design = release053QualityFeasibilityDesign();
  assert(
    design.sample.maximum_total_source_calls === 78,
    "Release 0.5.3A future call budget unexpectedly changed",
  );
  assert(
    design.screen_type === "NON_INFERENTIAL_DETERMINISTIC_ENGINEERING_SCREEN",
    "Release 0.5.3A screen must remain non-inferential",
  );
  assert(
    design.rationale.unestablished.includes("t24_t6_t1_temporal_stability")
      && design.rationale.unestablished.includes("later_category_robustness")
      && design.rationale.unestablished.includes("later_100_event_300_decision_cohort_floors"),
    "Release 0.5.3A future robustness boundaries must remain unestablished",
  );
  return RELEASE053A_OFFLINE_RECOMMENDATION;
}

export function release053AllowedCategories() {
  return [...PHASE0B_ALLOWED_CATEGORIES];
}
