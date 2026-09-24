import { open, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalSerialize, isSha256Hex, sha256Hex } from "./canonical.mjs";
import {
  DeterministicCryptoStructProofRunner,
} from "./cryptostruct-proof-runner.mjs";
import {
  PHASE0B_ALLOWED_CATEGORIES,
  QUALITY_GATE,
  createSourceMappingRecord,
  cryptoStructSourceContractHash,
  independentEventSpecHash,
  validateIndependentEventSpec,
  validateSourceMappingForSpec,
  validateSourceMappingRecord,
} from "./cryptostruct-source.mjs";

export const RELEASE052_STAGE2 = Object.freeze({
  max_attempted_calls: 45,
  max_unique_candidates: 50,
  per_call_timeout_ms: 10_000,
  whole_proof_timeout_ms: 480_000,
  max_deep_probe_candidates: 20,
});

export const RELEASE052_STAGE2_DISCOVERY_PLAN = Object.freeze([
  Object.freeze({ q: "weather", class: "prediction", venue: "polymarket", limit: 10 }),
  Object.freeze({ q: "inflation", class: "prediction", venue: "polymarket", limit: 10 }),
  Object.freeze({ q: "space", class: "prediction", venue: "polymarket", limit: 10 }),
  Object.freeze({ q: "AI", class: "prediction", venue: "polymarket", limit: 10 }),
  Object.freeze({ q: "movie", class: "prediction", venue: "polymarket", limit: 10 }),
]);

export const RELEASE052_STAGE2_SELECTOR_CONFIG = Object.freeze({
  version: "release-0.5.2-stage2-proof-probe-selector.v1",
  discovery_terminal_status: "SUCCESS",
  filter: Object.freeze({
    venue: "polymarket",
    instrument_class: "prediction",
    state: "open",
  }),
  dedupe_key: "instrument_id",
  preserve_first_occurrence: true,
  order: Object.freeze([
    "discovery_sequence_asc",
    "hit_index_asc",
    "instrument_id_numeric_asc_tiebreaker",
  ]),
  max_deep_probe_candidates: RELEASE052_STAGE2.max_deep_probe_candidates,
  deep_probe_tools: Object.freeze(["get_instrument", "get_market_snapshot"]),
  snapshot_requires: Object.freeze({
    terminal_status: "SUCCESS",
    venue: "polymarket",
    instrument_class: "prediction",
    state: "open",
  }),
  retry: false,
  replacement_candidate_on_failure: false,
  category_authority: "IndependentEventSpec.category",
  mapping_requirement: "VERIFIED SourceMappingRecord or semantic_mapping_unproven",
});

export const RELEASE052_SEMANTIC_MATCHER_VERSION =
  "release-0.5.2-exact-normalized-alias.v1";
export const RELEASE052_SEMANTIC_BUNDLE_SCHEMA =
  "release052-independent-semantic-bundle.v1";
export const RELEASE052_PROOF_SUMMARY_SCHEMA = "release052-proof-summary.v1";

const SHA256_HEX = /^[a-f0-9]{64}$/u;
const PROOF_RUN_ID = /^release-0\.5\.2-stage2-[a-z0-9][a-z0-9.-]*$/u;
const QUALITY_REASON_CODES = Object.freeze([
  "low_trades_60m",
  "low_turnover_60m",
  "invalid_or_wide_spread",
  "low_top1_depth",
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function plain(value, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value;
}

function closedKeys(value, allowed, label) {
  plain(value, label);
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    assert(allowedSet.has(key), `${label} contains unknown field: ${key}`);
  }
}

function positiveInteger(value, label) {
  assert(Number.isInteger(value) && value > 0, `${label} must be a positive integer`);
  return value;
}

function nonNegativeInteger(value, label) {
  assert(Number.isInteger(value) && value >= 0, `${label} must be a non-negative integer`);
  return value;
}

function nullableNonNegativeInteger(value, label) {
  assert(value === null || (Number.isInteger(value) && value >= 0), `${label} must be null or non-negative integer`);
  return value;
}

function parsePositiveInteger(value, label) {
  const parsed = Number(value);
  return positiveInteger(parsed, label);
}

function exact(value, expected, label) {
  assert(value === expected, `${label} mismatch`);
}

function validSha(value, label) {
  assert(typeof value === "string" && SHA256_HEX.test(value), `${label} must be SHA-256 hex`);
  return value;
}

function nonEmpty(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a non-empty string`);
  return value.trim();
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function normalizeRelease052SemanticKey(value) {
  return nonEmpty(value, "semantic match value")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/gu, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

export function validateRelease052IndependentSemanticBundle(bundle) {
  closedKeys(
    bundle,
    ["schema_version", "matcher_version", "events"],
    "IndependentSemanticBundle",
  );
  assert(
    bundle.schema_version === RELEASE052_SEMANTIC_BUNDLE_SCHEMA,
    "IndependentSemanticBundle schema_version mismatch",
  );
  assert(
    bundle.matcher_version === RELEASE052_SEMANTIC_MATCHER_VERSION,
    "IndependentSemanticBundle matcher_version mismatch",
  );
  assert(Array.isArray(bundle.events) && bundle.events.length > 0, "IndependentSemanticBundle.events must be non-empty");

  const eventIds = new Set();
  const specHashes = new Set();
  for (const [index, event] of bundle.events.entries()) {
    closedKeys(event, ["spec", "semantic_aliases"], `IndependentSemanticBundle.events[${index}]`);
    validateIndependentEventSpec(event.spec);
    assert(!eventIds.has(event.spec.event_id), "IndependentSemanticBundle duplicate event_id");
    eventIds.add(event.spec.event_id);
    const specHash = independentEventSpecHash(event.spec);
    assert(!specHashes.has(specHash), "IndependentSemanticBundle duplicate IndependentEventSpec");
    specHashes.add(specHash);

    assert(
      Array.isArray(event.semantic_aliases) && event.semantic_aliases.length > 0,
      `IndependentSemanticBundle.events[${index}].semantic_aliases must be non-empty`,
    );
    const normalizedAliases = event.semantic_aliases.map((alias) => normalizeRelease052SemanticKey(alias));
    assert(
      new Set(normalizedAliases).size === normalizedAliases.length,
      `IndependentSemanticBundle.events[${index}] contains duplicate normalized aliases`,
    );
  }
  return bundle;
}

export function parseRelease052IndependentSemanticBundle(value) {
  let bundle = value;
  if (typeof value === "string") {
    assert(value.trim().length > 0, "independent semantic bundle is required");
    try {
      bundle = JSON.parse(value);
    } catch (error) {
      throw new Error(`independent semantic bundle is invalid JSON: ${error.message}`);
    }
  }
  validateRelease052IndependentSemanticBundle(bundle);
  return deepFreeze(structuredClone(bundle));
}

export function release052IndependentSemanticBundleHash(bundle) {
  const validated = parseRelease052IndependentSemanticBundle(bundle);
  return sha256Hex(canonicalSerialize(validated));
}

export function release052Stage2Hashes() {
  return Object.freeze({
    source_contract_hash: cryptoStructSourceContractHash(),
    discovery_plan_hash: sha256Hex(canonicalSerialize(RELEASE052_STAGE2_DISCOVERY_PLAN)),
    selector_config_hash: sha256Hex(canonicalSerialize(RELEASE052_STAGE2_SELECTOR_CONFIG)),
  });
}

export function validateRelease052LiveAuthority(input) {
  assert(input && typeof input === "object", "authority input required");
  assert(
    typeof input.actual_runner_commit === "string" && input.actual_runner_commit.length > 0,
    "actual_runner_commit required",
  );
  assert(
    typeof input.authorized_runner_commit === "string" && input.authorized_runner_commit.length > 0,
    "authorized_runner_commit required",
  );
  exact(input.actual_runner_commit, input.authorized_runner_commit, "runner commit");

  assert(typeof input.proof_run_id === "string" && PROOF_RUN_ID.test(input.proof_run_id), "invalid proof_run_id");
  assert(
    typeof input.authorized_proof_run_id === "string" && PROOF_RUN_ID.test(input.authorized_proof_run_id),
    "invalid authorized_proof_run_id",
  );
  exact(input.proof_run_id, input.authorized_proof_run_id, "proof_run_id");

  const hashes = release052Stage2Hashes();
  validSha(input.expected_source_contract_hash, "expected_source_contract_hash");
  validSha(input.expected_discovery_plan_hash, "expected_discovery_plan_hash");
  validSha(input.expected_selector_config_hash, "expected_selector_config_hash");
  exact(hashes.source_contract_hash, input.expected_source_contract_hash, "source_contract_hash");
  exact(hashes.discovery_plan_hash, input.expected_discovery_plan_hash, "discovery_plan_hash");
  exact(hashes.selector_config_hash, input.expected_selector_config_hash, "selector_config_hash");

  exact(
    parsePositiveInteger(input.expected_max_attempted_calls, "expected_max_attempted_calls"),
    RELEASE052_STAGE2.max_attempted_calls,
    "max_attempted_calls",
  );
  exact(
    parsePositiveInteger(input.expected_max_unique_candidates, "expected_max_unique_candidates"),
    RELEASE052_STAGE2.max_unique_candidates,
    "max_unique_candidates",
  );
  exact(
    parsePositiveInteger(input.expected_per_call_timeout_ms, "expected_per_call_timeout_ms"),
    RELEASE052_STAGE2.per_call_timeout_ms,
    "per_call_timeout_ms",
  );
  exact(
    parsePositiveInteger(input.expected_whole_proof_timeout_ms, "expected_whole_proof_timeout_ms"),
    RELEASE052_STAGE2.whole_proof_timeout_ms,
    "whole_proof_timeout_ms",
  );

  const independentSemanticBundle = parseRelease052IndependentSemanticBundle(
    input.independent_semantic_bundle,
  );
  validSha(
    input.expected_independent_semantic_bundle_hash,
    "expected_independent_semantic_bundle_hash",
  );
  const independentSemanticBundleHash = release052IndependentSemanticBundleHash(
    independentSemanticBundle,
  );
  exact(
    independentSemanticBundleHash,
    input.expected_independent_semantic_bundle_hash,
    "independent_semantic_bundle_hash",
  );

  return deepFreeze({
    actual_runner_commit: input.actual_runner_commit,
    authorized_runner_commit: input.authorized_runner_commit,
    proof_run_id: input.proof_run_id,
    ...hashes,
    independent_semantic_bundle: independentSemanticBundle,
    independent_semantic_bundle_hash: independentSemanticBundleHash,
    ...RELEASE052_STAGE2,
  });
}

function numericInstrumentCompare(left, right) {
  try {
    const a = BigInt(left);
    const b = BigInt(right);
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  } catch {
    return String(left).localeCompare(String(right));
  }
}

export function selectRelease052DeepProbeCandidates(discoveryResults) {
  assert(Array.isArray(discoveryResults), "discoveryResults must be an array");
  const candidates = [];
  const seen = new Set();

  discoveryResults.forEach((result, discoveryIndex) => {
    if (result?.terminal_status !== "SUCCESS") return;
    const instruments = result?.parsed?.instruments;
    if (!Array.isArray(instruments)) return;
    instruments.forEach((instrument, hitIndex) => {
      if (
        instrument?.venue !== "polymarket"
        || instrument?.instrument_class !== "prediction"
        || instrument?.state !== "open"
      ) return;
      const instrumentId = String(instrument.instrument_id);
      if (seen.has(instrumentId)) return;
      seen.add(instrumentId);
      candidates.push(Object.freeze({
        instrument_id: instrumentId,
        discovery_sequence: discoveryIndex + 1,
        hit_index: hitIndex,
      }));
    });
  });

  candidates.sort((left, right) => (
    left.discovery_sequence - right.discovery_sequence
    || left.hit_index - right.hit_index
    || numericInstrumentCompare(left.instrument_id, right.instrument_id)
  ));

  return Object.freeze(candidates.slice(0, RELEASE052_STAGE2.max_deep_probe_candidates));
}

export function mapRelease052IndependentSemanticBundle({
  bundle,
  instrument,
  mappingTimestamp,
}) {
  const validatedBundle = parseRelease052IndependentSemanticBundle(bundle);
  const sourceMatchKey = normalizeRelease052SemanticKey(instrument.code);
  const matches = [];

  for (const event of validatedBundle.events) {
    for (const alias of event.semantic_aliases) {
      const normalizedAlias = normalizeRelease052SemanticKey(alias);
      if (normalizedAlias === sourceMatchKey) {
        matches.push({
          spec: event.spec,
          normalized_alias: normalizedAlias,
        });
        break;
      }
    }
  }

  if (matches.length !== 1) {
    return Object.freeze({
      status: "semantic_mapping_unproven",
      category: null,
      match_count: matches.length,
    });
  }

  const match = matches[0];
  const specHash = independentEventSpecHash(match.spec);
  const mappingEvidenceHash = sha256Hex(canonicalSerialize({
    matcher_version: RELEASE052_SEMANTIC_MATCHER_VERSION,
    independent_event_spec_hash: specHash,
    semantic_alias_hash: sha256Hex(match.normalized_alias),
    source_match_key_hash: sha256Hex(sourceMatchKey),
  }));

  const record = createSourceMappingRecord({
    independent_event_spec_hash: specHash,
    cryptostruct_instrument_id: instrument.instrument_id,
    cryptostruct_code: instrument.code,
    venue: instrument.venue,
    type: instrument.instrument_class,
    mapping_review_timestamp: mappingTimestamp,
    mapping_evidence_hash: mappingEvidenceHash,
    mapping_status: "VERIFIED",
  });
  validateSourceMappingRecord(record);
  const mappingValidation = validateSourceMappingForSpec({
    spec: match.spec,
    instrument,
    mapping_record: record,
  });
  if (!mappingValidation.valid) {
    return Object.freeze({
      status: "semantic_mapping_unproven",
      category: null,
      match_count: 1,
    });
  }

  return Object.freeze({
    status: "VERIFIED",
    category: match.spec.category,
    match_count: 1,
    independent_event_spec_hash: specHash,
    source_mapping_record_hash: mappingValidation.source_mapping_record_hash,
    mapping_evidence_hash: mappingEvidenceHash,
  });
}

export function release052SnapshotQuality(snapshot) {
  const reasons = [];
  if (snapshot.trades_60m < QUALITY_GATE.min_trades_60m) reasons.push("low_trades_60m");
  if (snapshot.turnover_usd_60m < QUALITY_GATE.min_turnover_usd_60m) reasons.push("low_turnover_60m");
  if (snapshot.spread_bps_60m_avg > QUALITY_GATE.max_spread_bps_60m_avg) reasons.push("invalid_or_wide_spread");
  if (
    snapshot.top1_depth_min_side_usd_60m
    < QUALITY_GATE.min_top1_depth_min_side_usd_60m
  ) reasons.push("low_top1_depth");
  return Object.freeze({ pass: reasons.length === 0, reasons: Object.freeze(reasons) });
}

function isEligibleInstrument(instrument) {
  return instrument
    && instrument.venue === "polymarket"
    && instrument.instrument_class === "prediction"
    && instrument.state === "open";
}

function emptyCategoryCounts() {
  return Object.fromEntries(PHASE0B_ALLOWED_CATEGORIES.map((category) => [category, 0]));
}

function emptyQualityReasonCounts() {
  return Object.fromEntries(QUALITY_REASON_CODES.map((reason) => [reason, 0]));
}

function emptySchemaFingerprintCounts() {
  return {
    search_instruments: {},
    get_instrument: {},
    get_market_snapshot: {},
  };
}

function addFingerprint(summary, tool, parsed) {
  const fingerprint = parsed?.source_schema_fingerprint;
  if (!isSha256Hex(fingerprint)) return;
  const bucket = summary.schema_fingerprints[tool];
  bucket[fingerprint] = (bucket[fingerprint] ?? 0) + 1;
}

function countTerminal(summary, status) {
  summary.terminal_status_counts[status] = (summary.terminal_status_counts[status] ?? 0) + 1;
}

function terminalSuccess(result, summary, tool) {
  countTerminal(summary, result.terminal_status);
  if (result.terminal_status !== "SUCCESS") return false;
  addFingerprint(summary, tool, result.parsed);
  return true;
}

function newSummary(validated) {
  return {
    schema_version: RELEASE052_PROOF_SUMMARY_SCHEMA,
    proof_run_id: validated.proof_run_id,
    runner_commit: validated.actual_runner_commit,
    source_contract_hash: validated.source_contract_hash,
    discovery_plan_hash: validated.discovery_plan_hash,
    selector_config_hash: validated.selector_config_hash,
    independent_semantic_bundle_hash: validated.independent_semantic_bundle_hash,
    discovery: {
      attempts: 0,
      successes: 0,
      total_matching_by_query: Object.fromEntries(
        RELEASE052_STAGE2_DISCOVERY_PLAN.map((item) => [item.q, null]),
      ),
      unique_discovered_candidate_count: 0,
    },
    selection: {
      selected_deep_probe_count: 0,
    },
    instrument: {
      attempts: 0,
      successes: 0,
      ineligible_count: 0,
    },
    snapshot: {
      attempts: 0,
      successes: 0,
    },
    semantic: {
      verified_count: 0,
      semantic_mapping_unproven_count: 0,
    },
    quality: {
      pass_count: 0,
      reject_count: 0,
      rejection_reason_counts: emptyQualityReasonCounts(),
    },
    joint_eligibility: {
      mapped_quality_pass: 0,
      mapped_quality_reject: 0,
      mapped_quality_pass_rate: null,
    },
    category: {
      mapped_quality_pass_counts: emptyCategoryCounts(),
    },
    schema_fingerprints: emptySchemaFingerprintCounts(),
    throughput_review_inputs: {
      unique_discovered_count: 0,
      discovery_total_matching_sum: 0,
      selected_count: 0,
      jointly_mapped_quality_pass_count: 0,
      mapped_quality_pass_count: 0,
      mapped_quality_reject_count: 0,
      mapped_quality_pass_rate: null,
      allowed_category_coverage_count: 0,
      allowed_category_counts: emptyCategoryCounts(),
    },
    terminal_status_counts: {},
    classification: "BLOCKED",
  };
}

function finalizeSummaryAggregates(summary) {
  const mappedEvaluable =
    summary.joint_eligibility.mapped_quality_pass
    + summary.joint_eligibility.mapped_quality_reject;
  summary.joint_eligibility.mapped_quality_pass_rate = mappedEvaluable === 0
    ? null
    : summary.joint_eligibility.mapped_quality_pass / mappedEvaluable;

  summary.throughput_review_inputs.unique_discovered_count =
    summary.discovery.unique_discovered_candidate_count;
  summary.throughput_review_inputs.discovery_total_matching_sum =
    Object.values(summary.discovery.total_matching_by_query)
      .filter((value) => Number.isInteger(value))
      .reduce((total, value) => total + value, 0);
  summary.throughput_review_inputs.selected_count =
    summary.selection.selected_deep_probe_count;
  summary.throughput_review_inputs.jointly_mapped_quality_pass_count =
    summary.joint_eligibility.mapped_quality_pass;
  summary.throughput_review_inputs.mapped_quality_pass_count =
    summary.joint_eligibility.mapped_quality_pass;
  summary.throughput_review_inputs.mapped_quality_reject_count =
    summary.joint_eligibility.mapped_quality_reject;
  summary.throughput_review_inputs.mapped_quality_pass_rate =
    summary.joint_eligibility.mapped_quality_pass_rate;
  summary.throughput_review_inputs.allowed_category_counts =
    structuredClone(summary.category.mapped_quality_pass_counts);
  summary.throughput_review_inputs.allowed_category_coverage_count =
    Object.values(summary.category.mapped_quality_pass_counts)
      .filter((count) => count > 0)
      .length;
  return summary;
}

function validateFingerprintBucket(bucket, label) {
  plain(bucket, label);
  for (const [fingerprint, count] of Object.entries(bucket)) {
    assert(isSha256Hex(fingerprint), `${label} key must be SHA-256 hex`);
    nonNegativeInteger(count, `${label}.${fingerprint}`);
  }
}

export function validateRelease052ProofSummary(summary) {
  closedKeys(summary, [
    "schema_version",
    "proof_run_id",
    "runner_commit",
    "source_contract_hash",
    "discovery_plan_hash",
    "selector_config_hash",
    "independent_semantic_bundle_hash",
    "discovery",
    "selection",
    "instrument",
    "snapshot",
    "semantic",
    "quality",
    "joint_eligibility",
    "category",
    "schema_fingerprints",
    "throughput_review_inputs",
    "terminal_status_counts",
    "classification",
  ], "Release052ProofSummary");
  assert(summary.schema_version === RELEASE052_PROOF_SUMMARY_SCHEMA, "proof summary schema_version mismatch");
  nonEmpty(summary.proof_run_id, "proof summary proof_run_id");
  nonEmpty(summary.runner_commit, "proof summary runner_commit");
  for (const field of [
    "source_contract_hash",
    "discovery_plan_hash",
    "selector_config_hash",
    "independent_semantic_bundle_hash",
  ]) validSha(summary[field], `proof summary ${field}`);

  closedKeys(summary.discovery, [
    "attempts",
    "successes",
    "total_matching_by_query",
    "unique_discovered_candidate_count",
  ], "proof summary discovery");
  nonNegativeInteger(summary.discovery.attempts, "proof summary discovery.attempts");
  nonNegativeInteger(summary.discovery.successes, "proof summary discovery.successes");
  closedKeys(
    summary.discovery.total_matching_by_query,
    RELEASE052_STAGE2_DISCOVERY_PLAN.map((item) => item.q),
    "proof summary discovery.total_matching_by_query",
  );
  for (const [query, value] of Object.entries(summary.discovery.total_matching_by_query)) {
    nullableNonNegativeInteger(value, `proof summary discovery.total_matching_by_query.${query}`);
  }
  nonNegativeInteger(
    summary.discovery.unique_discovered_candidate_count,
    "proof summary discovery.unique_discovered_candidate_count",
  );

  closedKeys(summary.selection, ["selected_deep_probe_count"], "proof summary selection");
  nonNegativeInteger(summary.selection.selected_deep_probe_count, "proof summary selected_deep_probe_count");
  closedKeys(summary.instrument, ["attempts", "successes", "ineligible_count"], "proof summary instrument");
  for (const field of ["attempts", "successes", "ineligible_count"]) {
    nonNegativeInteger(summary.instrument[field], `proof summary instrument.${field}`);
  }
  closedKeys(summary.snapshot, ["attempts", "successes"], "proof summary snapshot");
  for (const field of ["attempts", "successes"]) {
    nonNegativeInteger(summary.snapshot[field], `proof summary snapshot.${field}`);
  }
  closedKeys(summary.semantic, ["verified_count", "semantic_mapping_unproven_count"], "proof summary semantic");
  for (const field of ["verified_count", "semantic_mapping_unproven_count"]) {
    nonNegativeInteger(summary.semantic[field], `proof summary semantic.${field}`);
  }

  closedKeys(summary.quality, ["pass_count", "reject_count", "rejection_reason_counts"], "proof summary quality");
  nonNegativeInteger(summary.quality.pass_count, "proof summary quality.pass_count");
  nonNegativeInteger(summary.quality.reject_count, "proof summary quality.reject_count");
  closedKeys(summary.quality.rejection_reason_counts, QUALITY_REASON_CODES, "proof summary quality.rejection_reason_counts");
  for (const reason of QUALITY_REASON_CODES) {
    nonNegativeInteger(
      summary.quality.rejection_reason_counts[reason],
      `proof summary quality.rejection_reason_counts.${reason}`,
    );
  }

  closedKeys(
    summary.joint_eligibility,
    ["mapped_quality_pass", "mapped_quality_reject", "mapped_quality_pass_rate"],
    "proof summary joint_eligibility",
  );
  nonNegativeInteger(summary.joint_eligibility.mapped_quality_pass, "proof summary mapped_quality_pass");
  nonNegativeInteger(summary.joint_eligibility.mapped_quality_reject, "proof summary mapped_quality_reject");
  assert(
    summary.joint_eligibility.mapped_quality_pass_rate === null
      || (
        typeof summary.joint_eligibility.mapped_quality_pass_rate === "number"
        && summary.joint_eligibility.mapped_quality_pass_rate >= 0
        && summary.joint_eligibility.mapped_quality_pass_rate <= 1
      ),
    "proof summary mapped_quality_pass_rate must be null or [0,1]",
  );

  closedKeys(summary.category, ["mapped_quality_pass_counts"], "proof summary category");
  closedKeys(
    summary.category.mapped_quality_pass_counts,
    PHASE0B_ALLOWED_CATEGORIES,
    "proof summary category.mapped_quality_pass_counts",
  );
  for (const category of PHASE0B_ALLOWED_CATEGORIES) {
    nonNegativeInteger(
      summary.category.mapped_quality_pass_counts[category],
      `proof summary category.${category}`,
    );
  }

  closedKeys(
    summary.schema_fingerprints,
    ["search_instruments", "get_instrument", "get_market_snapshot"],
    "proof summary schema_fingerprints",
  );
  for (const tool of ["search_instruments", "get_instrument", "get_market_snapshot"]) {
    validateFingerprintBucket(summary.schema_fingerprints[tool], `proof summary schema_fingerprints.${tool}`);
  }

  closedKeys(summary.throughput_review_inputs, [
    "unique_discovered_count",
    "discovery_total_matching_sum",
    "selected_count",
    "jointly_mapped_quality_pass_count",
    "mapped_quality_pass_count",
    "mapped_quality_reject_count",
    "mapped_quality_pass_rate",
    "allowed_category_coverage_count",
    "allowed_category_counts",
  ], "proof summary throughput_review_inputs");
  for (const field of [
    "unique_discovered_count",
    "discovery_total_matching_sum",
    "selected_count",
    "jointly_mapped_quality_pass_count",
    "mapped_quality_pass_count",
    "mapped_quality_reject_count",
    "allowed_category_coverage_count",
  ]) {
    nonNegativeInteger(summary.throughput_review_inputs[field], `proof summary throughput_review_inputs.${field}`);
  }
  assert(
    summary.throughput_review_inputs.mapped_quality_pass_rate === null
      || (
        typeof summary.throughput_review_inputs.mapped_quality_pass_rate === "number"
        && summary.throughput_review_inputs.mapped_quality_pass_rate >= 0
        && summary.throughput_review_inputs.mapped_quality_pass_rate <= 1
      ),
    "proof summary throughput mapped_quality_pass_rate must be null or [0,1]",
  );
  closedKeys(
    summary.throughput_review_inputs.allowed_category_counts,
    PHASE0B_ALLOWED_CATEGORIES,
    "proof summary throughput allowed_category_counts",
  );

  plain(summary.terminal_status_counts, "proof summary terminal_status_counts");
  for (const count of Object.values(summary.terminal_status_counts)) {
    nonNegativeInteger(count, "proof summary terminal status count");
  }
  assert(["QUALIFIED", "INSUFFICIENT", "BLOCKED"].includes(summary.classification), "proof summary classification invalid");
  return summary;
}

async function durableWriteSummary(path, summary) {
  validateRelease052ProofSummary(summary);
  const temporary = path + ".tmp";
  await writeFile(temporary, canonicalSerialize(summary) + "\n", "utf8");
  const handle = await open(temporary, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
}

export async function writeRelease052ProofSummary(outputDir, summary) {
  finalizeSummaryAggregates(summary);
  validateRelease052ProofSummary(summary);
  await durableWriteSummary(join(outputDir, "proof-summary.json"), summary);
  return deepFreeze(structuredClone(summary));
}

export async function readRelease052ProofSummary(outputDir) {
  const parsed = JSON.parse(await readFile(join(outputDir, "proof-summary.json"), "utf8"));
  validateRelease052ProofSummary(parsed);
  return deepFreeze(parsed);
}

export async function executeRelease052LiveProof({
  outputDir,
  authority,
  invokeTool,
}) {
  const validated = validateRelease052LiveAuthority(authority);
  const summary = newSummary(validated);
  const runnerInput = {
    outputDir,
    proof_run_id: validated.proof_run_id,
    source_contract_hash: validated.source_contract_hash,
    runner_commit: validated.actual_runner_commit,
    runner_version: "0.5.2",
    max_attempted_calls: RELEASE052_STAGE2.max_attempted_calls,
    max_unique_candidates: RELEASE052_STAGE2.max_unique_candidates,
    per_call_timeout_ms: RELEASE052_STAGE2.per_call_timeout_ms,
    whole_proof_timeout_ms: RELEASE052_STAGE2.whole_proof_timeout_ms,
    discovery_plan: RELEASE052_STAGE2_DISCOVERY_PLAN,
    selector_config: RELEASE052_STAGE2_SELECTOR_CONFIG,
  };
  if (invokeTool !== undefined) runnerInput.invokeTool = invokeTool;

  const runner = await DeterministicCryptoStructProofRunner.create(runnerInput);
  try {
    const discoveryResults = [];
    for (const discovery of RELEASE052_STAGE2_DISCOVERY_PLAN) {
      const result = await runner.executeCall("search_instruments", { ...discovery });
      summary.discovery.attempts += 1;
      if (terminalSuccess(result, summary, "search_instruments")) {
        summary.discovery.successes += 1;
        summary.discovery.total_matching_by_query[discovery.q] = result.parsed.total_matching;
      }
      discoveryResults.push(result);
    }

    summary.discovery.unique_discovered_candidate_count =
      runner.ledgerState().unique_candidate_count;

    const candidates = selectRelease052DeepProbeCandidates(discoveryResults);
    summary.selection.selected_deep_probe_count = candidates.length;

    for (const candidate of candidates) {
      const instrumentId = candidate.instrument_id;
      const instrumentResult = await runner.executeCall(
        "get_instrument",
        { instrument_id: Number(instrumentId) },
        { instrumentId },
      );
      summary.instrument.attempts += 1;
      if (!terminalSuccess(instrumentResult, summary, "get_instrument")) continue;
      summary.instrument.successes += 1;

      if (!isEligibleInstrument(instrumentResult.parsed)) {
        summary.instrument.ineligible_count += 1;
        continue;
      }

      const mapping = mapRelease052IndependentSemanticBundle({
        bundle: validated.independent_semantic_bundle,
        instrument: instrumentResult.parsed,
        mappingTimestamp: instrumentResult.terminal.completion_timestamp,
      });
      if (mapping.status === "VERIFIED") summary.semantic.verified_count += 1;
      else summary.semantic.semantic_mapping_unproven_count += 1;

      const snapshot = await runner.executeCall(
        "get_market_snapshot",
        { instrument_id: Number(instrumentId) },
        { instrumentId },
      );
      summary.snapshot.attempts += 1;
      if (!terminalSuccess(snapshot, summary, "get_market_snapshot")) continue;
      summary.snapshot.successes += 1;

      const quality = release052SnapshotQuality(snapshot.parsed);
      if (quality.pass) {
        summary.quality.pass_count += 1;
      } else {
        summary.quality.reject_count += 1;
        for (const reason of quality.reasons) {
          summary.quality.rejection_reason_counts[reason] += 1;
        }
      }

      if (mapping.status === "VERIFIED") {
        if (quality.pass) {
          summary.joint_eligibility.mapped_quality_pass += 1;
          summary.category.mapped_quality_pass_counts[mapping.category] += 1;
        } else {
          summary.joint_eligibility.mapped_quality_reject += 1;
        }
      }
    }

    const nonSuccess = Object.entries(summary.terminal_status_counts)
      .filter(([status]) => status !== "SUCCESS")
      .reduce((total, [, count]) => total + count, 0);

    if (nonSuccess > 0) summary.classification = "BLOCKED";
    else if (summary.joint_eligibility.mapped_quality_pass > 0) {
      summary.classification = "QUALIFIED";
    } else {
      summary.classification = "INSUFFICIENT";
    }

    runner.close();
    const durableSummary = await writeRelease052ProofSummary(outputDir, summary);
    return Object.freeze({
      classification: durableSummary.classification,
      summary: durableSummary,
    });
  } catch (error) {
    runner.close();
    summary.discovery.unique_discovered_candidate_count =
      runner.ledgerState().unique_candidate_count;
    summary.classification = "BLOCKED";
    await writeRelease052ProofSummary(outputDir, summary);
    throw error;
  }
}
