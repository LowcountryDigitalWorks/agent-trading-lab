import { isSha256Hex } from "./canonical.mjs";

export const ACTIONS = Object.freeze(["BUY", "SELL", "HOLD", "SKIP"]);
export const DECISION_STATUSES = Object.freeze(["ok", "invalid", "timeout", "unavailable"]);
export const EVIDENCE_EVENT_TYPES = Object.freeze([
  "run_started",
  "candidate",
  "decision",
  "gate",
  "fill",
  "resolution",
  "metric",
  "run_closed",
]);

function assert(condition, message) {
  if (!condition) throw new TypeError(message);
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function requireFields(object, fields, label) {
  assert(object && typeof object === "object" && !Array.isArray(object), `${label} must be an object`);
  for (const field of fields) {
    assert(hasOwn(object, field), `${label} missing required field: ${field}`);
  }
}

function rejectUnknownFields(object, allowedFields, label) {
  const allowed = new Set(allowedFields);
  for (const field of Object.keys(object)) {
    assert(allowed.has(field), `${label} contains unknown field: ${field}`);
  }
}

function assertString(value, name) {
  assert(typeof value === "string" && value.length > 0, `${name} must be a non-empty string`);
}

function assertNullableString(value, name) {
  assert(value === null || (typeof value === "string" && value.length > 0), `${name} must be null or a non-empty string`);
}

function assertIsoUtc(value, name) {
  assertString(value, name);
  assert(value.endsWith("Z") && !Number.isNaN(Date.parse(value)), `${name} must be an ISO-8601 UTC timestamp`);
}

function assertNonNegativeNumber(value, name) {
  assert(typeof value === "number" && Number.isFinite(value) && value >= 0, `${name} must be a finite non-negative number`);
}

export function validateCandidateEnvelope(candidate) {
  const fields = [
    "schema_version",
    "experiment_id",
    "track",
    "candidate_id",
    "event_time_utc",
    "decision_time_utc",
    "observation_cutoff_utc",
    "source_id",
    "source_version",
    "venue",
    "instrument_id",
    "instrument_type",
    "state_hash",
    "features",
    "market_state",
    "context_refs",
  ];
  requireFields(candidate, fields, "CandidateEnvelope");
  rejectUnknownFields(candidate, fields, "CandidateEnvelope");
  assert(candidate.schema_version === "candidate-envelope.v1", "CandidateEnvelope schema_version must be candidate-envelope.v1");
  assert(["0A", "0B"].includes(candidate.track), "CandidateEnvelope track must be 0A or 0B");
  for (const field of ["experiment_id", "candidate_id", "source_id", "source_version", "venue", "instrument_id", "instrument_type"]) {
    assertString(candidate[field], `CandidateEnvelope.${field}`);
  }
  for (const field of ["event_time_utc", "decision_time_utc", "observation_cutoff_utc"]) {
    assertIsoUtc(candidate[field], `CandidateEnvelope.${field}`);
  }
  assert(isSha256Hex(candidate.state_hash), "CandidateEnvelope.state_hash must be a lowercase SHA-256 hex digest");
  assert(Array.isArray(candidate.features), "CandidateEnvelope.features must be an array");
  assert(candidate.market_state && typeof candidate.market_state === "object" && !Array.isArray(candidate.market_state), "CandidateEnvelope.market_state must be an object");
  assert(Array.isArray(candidate.context_refs), "CandidateEnvelope.context_refs must be an array");

  const cutoff = Date.parse(candidate.observation_cutoff_utc);
  for (const [index, feature] of candidate.features.entries()) {
    requireFields(feature, ["name", "value", "available_at_utc"], `CandidateEnvelope.features[${index}]`);
    assertString(feature.name, `CandidateEnvelope.features[${index}].name`);
    assertIsoUtc(feature.available_at_utc, `CandidateEnvelope.features[${index}].available_at_utc`);
    assert(Date.parse(feature.available_at_utc) <= cutoff, `CandidateEnvelope.features[${index}] is not available by observation cutoff`);
  }
  for (const [index, ref] of candidate.context_refs.entries()) {
    requireFields(ref, ["ref_id", "available_at_utc"], `CandidateEnvelope.context_refs[${index}]`);
    assertString(ref.ref_id, `CandidateEnvelope.context_refs[${index}].ref_id`);
    assertIsoUtc(ref.available_at_utc, `CandidateEnvelope.context_refs[${index}].available_at_utc`);
    assert(Date.parse(ref.available_at_utc) <= cutoff, `CandidateEnvelope.context_refs[${index}] is not available by observation cutoff`);
  }
  return candidate;
}

export function validateDecisionRecord(decision) {
  const fields = [
    "candidate_id",
    "adapter_id",
    "adapter_version",
    "action",
    "instrument_side",
    "p_yes",
    "status",
    "model_id",
    "model_version",
    "prompt_version",
    "schema_version",
    "input_hash",
    "output_hash",
    "latency_ms",
    "input_tokens",
    "output_tokens",
    "incremental_cost_usd",
  ];
  requireFields(decision, fields, "DecisionRecord");
  rejectUnknownFields(decision, fields, "DecisionRecord");
  assert(decision.schema_version === "decision-record.v1", "DecisionRecord schema_version must be decision-record.v1");
  for (const field of ["candidate_id", "adapter_id", "adapter_version"]) assertString(decision[field], `DecisionRecord.${field}`);
  assert(ACTIONS.includes(decision.action), "DecisionRecord.action is invalid");
  assert(decision.instrument_side === null || ["YES", "NO"].includes(decision.instrument_side), "DecisionRecord.instrument_side must be YES, NO, or null");
  assert(decision.p_yes === null || (typeof decision.p_yes === "number" && decision.p_yes >= 0.01 && decision.p_yes <= 0.99), "DecisionRecord.p_yes must be null or within [0.01, 0.99]");
  assert(DECISION_STATUSES.includes(decision.status), "DecisionRecord.status is invalid");
  for (const field of ["model_id", "model_version", "prompt_version"]) assertNullableString(decision[field], `DecisionRecord.${field}`);
  assert(isSha256Hex(decision.input_hash), "DecisionRecord.input_hash must be SHA-256 hex");
  assert(isSha256Hex(decision.output_hash), "DecisionRecord.output_hash must be SHA-256 hex");
  assertNonNegativeNumber(decision.latency_ms, "DecisionRecord.latency_ms");
  assert(Number.isInteger(decision.latency_ms), "DecisionRecord.latency_ms must be an integer");
  for (const field of ["input_tokens", "output_tokens"]) {
    assert(decision[field] === null || (Number.isInteger(decision[field]) && decision[field] >= 0), `DecisionRecord.${field} must be null or a non-negative integer`);
  }
  assertNonNegativeNumber(decision.incremental_cost_usd, "DecisionRecord.incremental_cost_usd");
  if (decision.status !== "ok") assert(decision.action === "SKIP", "Non-ok DecisionRecord must fail closed to SKIP");
  return decision;
}

export function validateGateResult(gate) {
  const fields = ["schema_version", "candidate_id", "decision_output_hash", "accepted", "action", "reason_code", "reason_detail"];
  requireFields(gate, fields, "GateResult");
  rejectUnknownFields(gate, fields, "GateResult");
  assert(gate.schema_version === "gate-result.v1", "GateResult schema_version must be gate-result.v1");
  assertString(gate.candidate_id, "GateResult.candidate_id");
  assert(isSha256Hex(gate.decision_output_hash), "GateResult.decision_output_hash must be SHA-256 hex");
  assert(typeof gate.accepted === "boolean", "GateResult.accepted must be boolean");
  assert(ACTIONS.includes(gate.action), "GateResult.action is invalid");
  assertString(gate.reason_code, "GateResult.reason_code");
  assert(gate.reason_detail === null || typeof gate.reason_detail === "string", "GateResult.reason_detail must be string or null");
  if (!gate.accepted) assert(gate.action === "SKIP", "Rejected GateResult must return SKIP");
  return gate;
}

export function validateFillRecord(fill) {
  const fields = ["schema_version", "candidate_id", "action_id", "execution_time_utc", "side", "requested_qty", "filled_qty", "reference_price", "effective_price", "fee", "spread_cost", "slippage_cost", "fill_status", "execution_mode", "source_hash"];
  requireFields(fill, fields, "FillRecord");
  rejectUnknownFields(fill, fields, "FillRecord");
  assert(fill.schema_version === "fill-record.v1", "FillRecord schema_version must be fill-record.v1");
  for (const field of ["candidate_id", "action_id", "side", "fill_status", "execution_mode"]) assertString(fill[field], `FillRecord.${field}`);
  assertIsoUtc(fill.execution_time_utc, "FillRecord.execution_time_utc");
  for (const field of ["requested_qty", "filled_qty", "reference_price", "effective_price", "fee", "spread_cost", "slippage_cost"]) assertNonNegativeNumber(fill[field], `FillRecord.${field}`);
  assert(isSha256Hex(fill.source_hash), "FillRecord.source_hash must be SHA-256 hex");
  return fill;
}

export function validateEvidenceEvent(record) {
  const fields = ["schema_version", "run_id", "sequence", "event_type", "recorded_at_utc", "payload", "prev_record_hash", "record_hash"];
  requireFields(record, fields, "EvidenceEvent");
  rejectUnknownFields(record, fields, "EvidenceEvent");
  assert(record.schema_version === "evidence-event.v1", "EvidenceEvent schema_version must be evidence-event.v1");
  assertString(record.run_id, "EvidenceEvent.run_id");
  assert(Number.isInteger(record.sequence) && record.sequence >= 0, "EvidenceEvent.sequence must be a non-negative integer");
  assert(EVIDENCE_EVENT_TYPES.includes(record.event_type), "EvidenceEvent.event_type is invalid");
  assertIsoUtc(record.recorded_at_utc, "EvidenceEvent.recorded_at_utc");
  assert(record.payload !== undefined, "EvidenceEvent.payload is required");
  assert(record.prev_record_hash === null || isSha256Hex(record.prev_record_hash), "EvidenceEvent.prev_record_hash must be null or SHA-256 hex");
  assert(isSha256Hex(record.record_hash), "EvidenceEvent.record_hash must be SHA-256 hex");
  return record;
}
