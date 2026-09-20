import { canonicalSerialize, sha256Hex } from "./canonical.mjs";
import { validateDecisionRecord } from "./contracts.mjs";

const FAILURE_STATUSES = new Set(["invalid", "timeout", "unavailable"]);

export function failClosedTreatmentDecision({
  candidate_id,
  track,
  status,
  control_p_yes = null,
  input_hash,
  adapter_id = "bounded-treatment",
  adapter_version = "0.1",
  latency_ms = 0,
}) {
  if (!FAILURE_STATUSES.has(status)) throw new TypeError("status must be invalid, timeout, or unavailable");
  if (!['0A', '0B'].includes(track)) throw new TypeError("track must be 0A or 0B");
  if (track === "0B" && !(typeof control_p_yes === "number" && control_p_yes >= 0.01 && control_p_yes <= 0.99)) {
    throw new TypeError("0B fail-closed scoring requires control_p_yes within [0.01, 0.99]");
  }

  const normalizedOutput = {
    action: "SKIP",
    instrument_side: null,
    p_yes: track === "0B" ? control_p_yes : null,
    status,
  };

  const record = {
    candidate_id,
    adapter_id,
    adapter_version,
    action: normalizedOutput.action,
    instrument_side: normalizedOutput.instrument_side,
    p_yes: normalizedOutput.p_yes,
    status: normalizedOutput.status,
    model_id: null,
    model_version: null,
    prompt_version: null,
    schema_version: "decision-record.v1",
    input_hash,
    output_hash: sha256Hex(canonicalSerialize(normalizedOutput)),
    latency_ms,
    input_tokens: null,
    output_tokens: null,
    incremental_cost_usd: 0,
  };
  return validateDecisionRecord(record);
}
