import { canonicalSerialize, isSha256Hex, sha256Hex } from "./canonical.mjs";

function assert(condition, message) {
  if (!condition) throw new TypeError(message);
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function requireFields(object, fields, label) {
  assert(object && typeof object === "object" && !Array.isArray(object), `${label} must be an object`);
  for (const field of fields) assert(hasOwn(object, field), `${label} missing required field: ${field}`);
}

function rejectUnknownFields(object, allowedFields, label) {
  const allowed = new Set(allowedFields);
  for (const field of Object.keys(object)) {
    assert(allowed.has(field), `${label} contains unknown field: ${field}`);
  }
}

function requireClosedFields(object, fields, label) {
  requireFields(object, fields, label);
  rejectUnknownFields(object, fields, label);
}

function nonEmptyString(value, label) {
  assert(typeof value === "string" && value.length > 0, `${label} must be a non-empty string`);
}

function isoUtc(value, label) {
  nonEmptyString(value, label);
  assert(value.endsWith("Z") && !Number.isNaN(Date.parse(value)), `${label} must be an ISO-8601 UTC timestamp`);
}

function nullableString(value, label) {
  assert(value === null || (typeof value === "string" && value.length > 0), `${label} must be null or a non-empty string`);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function validateRunManifest(manifest) {
  const fields = [
    "schema_version",
    "run_id",
    "experiment_id",
    "track",
    "created_at_utc",
    "source",
    "derived_artifacts",
    "transform_code_commit",
    "integrations",
    "model",
    "deterministic_seeds",
    "git_commit",
    "environment_lock_hash",
    "execution_config",
    "cost_config",
    "partitions",
    "allowed_redesign_count",
  ];
  requireClosedFields(manifest, fields, "RunManifest");
  assert(manifest.schema_version === "run-manifest.v1", "RunManifest schema_version must be run-manifest.v1");
  nonEmptyString(manifest.run_id, "RunManifest.run_id");
  nonEmptyString(manifest.experiment_id, "RunManifest.experiment_id");
  assert(["0A", "0B"].includes(manifest.track), "RunManifest.track must be 0A or 0B");
  isoUtc(manifest.created_at_utc, "RunManifest.created_at_utc");

  requireClosedFields(manifest.source, ["name", "version_ref", "upstream_url", "retrieved_at_utc", "license_ref", "coverage", "counts", "timezone", "raw_inputs"], "RunManifest.source");
  for (const field of ["name", "version_ref", "upstream_url", "license_ref", "timezone"]) nonEmptyString(manifest.source[field], `RunManifest.source.${field}`);
  isoUtc(manifest.source.retrieved_at_utc, "RunManifest.source.retrieved_at_utc");
  requireClosedFields(manifest.source.coverage, ["start_utc", "end_utc"], "RunManifest.source.coverage");
  isoUtc(manifest.source.coverage.start_utc, "RunManifest.source.coverage.start_utc");
  isoUtc(manifest.source.coverage.end_utc, "RunManifest.source.coverage.end_utc");
  assert(Date.parse(manifest.source.coverage.start_utc) <= Date.parse(manifest.source.coverage.end_utc), "RunManifest source coverage is inverted");
  requireClosedFields(manifest.source.counts, ["rows", "events", "markets"], "RunManifest.source.counts");
  for (const field of ["rows", "events", "markets"]) assert(Number.isInteger(manifest.source.counts[field]) && manifest.source.counts[field] >= 0, `RunManifest.source.counts.${field} must be a non-negative integer`);
  assert(Array.isArray(manifest.source.raw_inputs) && manifest.source.raw_inputs.length > 0, "RunManifest.source.raw_inputs must be a non-empty array");
  for (const [index, item] of manifest.source.raw_inputs.entries()) {
    requireClosedFields(item, ["name", "sha256"], `RunManifest.source.raw_inputs[${index}]`);
    nonEmptyString(item.name, `RunManifest.source.raw_inputs[${index}].name`);
    assert(isSha256Hex(item.sha256), `RunManifest.source.raw_inputs[${index}].sha256 must be SHA-256 hex`);
  }

  assert(Array.isArray(manifest.derived_artifacts), "RunManifest.derived_artifacts must be an array");
  for (const [index, item] of manifest.derived_artifacts.entries()) {
    requireClosedFields(item, ["name", "sha256", "parent_hashes"], `RunManifest.derived_artifacts[${index}]`);
    nonEmptyString(item.name, `RunManifest.derived_artifacts[${index}].name`);
    assert(isSha256Hex(item.sha256), `RunManifest.derived_artifacts[${index}].sha256 must be SHA-256 hex`);
    assert(Array.isArray(item.parent_hashes) && item.parent_hashes.every(isSha256Hex), `RunManifest.derived_artifacts[${index}].parent_hashes must contain SHA-256 hex values`);
  }

  nonEmptyString(manifest.transform_code_commit, "RunManifest.transform_code_commit");
  requireClosedFields(manifest.integrations, ["freqtrade_ref", "prediction_market_bench_ref"], "RunManifest.integrations");
  nullableString(manifest.integrations.freqtrade_ref, "RunManifest.integrations.freqtrade_ref");
  nullableString(manifest.integrations.prediction_market_bench_ref, "RunManifest.integrations.prediction_market_bench_ref");

  requireClosedFields(manifest.model, ["provider", "model_id", "model_version", "prompt_version", "prompt_hash", "adapter_version", "schema_hash"], "RunManifest.model");
  for (const field of ["provider", "model_id", "model_version", "prompt_version", "adapter_version"]) nullableString(manifest.model[field], `RunManifest.model.${field}`);
  for (const field of ["prompt_hash", "schema_hash"]) assert(manifest.model[field] === null || isSha256Hex(manifest.model[field]), `RunManifest.model.${field} must be null or SHA-256 hex`);

  assert(manifest.deterministic_seeds && typeof manifest.deterministic_seeds === "object" && !Array.isArray(manifest.deterministic_seeds), "RunManifest.deterministic_seeds must be an object");
  nonEmptyString(manifest.git_commit, "RunManifest.git_commit");
  assert(isSha256Hex(manifest.environment_lock_hash), "RunManifest.environment_lock_hash must be SHA-256 hex");
  assert(manifest.execution_config && typeof manifest.execution_config === "object" && !Array.isArray(manifest.execution_config), "RunManifest.execution_config must be an object");
  assert(manifest.cost_config && typeof manifest.cost_config === "object" && !Array.isArray(manifest.cost_config), "RunManifest.cost_config must be an object");
  assert(Array.isArray(manifest.partitions) && manifest.partitions.length > 0, "RunManifest.partitions must be a non-empty array");
  for (const [index, partition] of manifest.partitions.entries()) {
    requireClosedFields(partition, ["name", "fraction", "locked"], `RunManifest.partitions[${index}]`);
    nonEmptyString(partition.name, `RunManifest.partitions[${index}].name`);
    assert(typeof partition.fraction === "number" && Number.isFinite(partition.fraction) && partition.fraction > 0 && partition.fraction <= 1, `RunManifest.partitions[${index}].fraction must be in (0, 1]`);
    assert(typeof partition.locked === "boolean", `RunManifest.partitions[${index}].locked must be boolean`);
  }
  const fractionTotal = manifest.partitions.reduce((sum, partition) => sum + partition.fraction, 0);
  assert(Math.abs(fractionTotal - 1) < 1e-12, "RunManifest partition fractions must sum to 1");
  assert(Number.isInteger(manifest.allowed_redesign_count) && manifest.allowed_redesign_count >= 0, "RunManifest.allowed_redesign_count must be a non-negative integer");
  return manifest;
}

export function createRunManifest(input) {
  const clone = structuredClone(input);
  validateRunManifest(clone);
  return deepFreeze(clone);
}

export function runManifestDigest(manifest) {
  validateRunManifest(manifest);
  return sha256Hex(canonicalSerialize(manifest));
}
