import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateCandidateEnvelope, validateDecisionRecord, validateFillRecord, validateGateResult } from "../src/contracts.mjs";
import { sha256Hex } from "../src/canonical.mjs";

async function fixture(name) {
  return JSON.parse(await readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
}

test("CandidateEnvelope v1 fixture conforms to the runtime contract", async () => {
  const candidate = await fixture("candidate-envelope.v1.json");
  assert.equal(validateCandidateEnvelope(candidate), candidate);
});


test("CandidateEnvelope rejects unknown top-level properties", async () => {
  const candidate = await fixture("candidate-envelope.v1.json");
  candidate.unmodeled_field = "must-fail";
  assert.throws(() => validateCandidateEnvelope(candidate), /unknown field: unmodeled_field/u);
});

test("CandidateEnvelope preserves intentionally open feature and context-ref properties", async () => {
  const candidate = await fixture("candidate-envelope.v1.json");
  candidate.features[0].source_note = "allowed-by-schema";
  candidate.context_refs[0].publication_kind = "synthetic";
  assert.equal(validateCandidateEnvelope(candidate), candidate);
});

test("CandidateEnvelope rejects features that were unavailable at the cutoff", async () => {
  const candidate = await fixture("candidate-envelope.v1.json");
  candidate.features[0].available_at_utc = "2026-01-01T12:00:01Z";
  assert.throws(() => validateCandidateEnvelope(candidate), /not available by observation cutoff/u);
});

test("DecisionRecord, GateResult, and FillRecord v1 minimal valid shapes conform", () => {
  const decision = {
    candidate_id: "c1",
    adapter_id: "baseline",
    adapter_version: "1",
    action: "HOLD",
    instrument_side: null,
    p_yes: null,
    status: "ok",
    model_id: null,
    model_version: null,
    prompt_version: null,
    schema_version: "decision-record.v1",
    input_hash: sha256Hex("input"),
    output_hash: sha256Hex("output"),
    latency_ms: 0,
    input_tokens: null,
    output_tokens: null,
    incremental_cost_usd: 0,
  };
  assert.equal(validateDecisionRecord(decision), decision);

  const gate = {
    schema_version: "gate-result.v1",
    candidate_id: "c1",
    decision_output_hash: decision.output_hash,
    accepted: true,
    action: "HOLD",
    reason_code: "accepted",
    reason_detail: null,
  };
  assert.equal(validateGateResult(gate), gate);

  const fill = {
    schema_version: "fill-record.v1",
    candidate_id: "c1",
    action_id: "a1",
    execution_time_utc: "2026-01-01T00:05:00Z",
    side: "BUY",
    requested_qty: 1,
    filled_qty: 1,
    reference_price: 100,
    effective_price: 100.1,
    fee: 0.1,
    spread_cost: 0.02,
    slippage_cost: 0.03,
    fill_status: "filled",
    execution_mode: "synthetic",
    source_hash: sha256Hex("source"),
  };
  assert.equal(validateFillRecord(fill), fill);
});
