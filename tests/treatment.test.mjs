import test from "node:test";
import assert from "node:assert/strict";
import { sha256Hex } from "../src/canonical.mjs";
import { failClosedTreatmentDecision } from "../src/treatment.mjs";

for (const status of ["invalid", "timeout", "unavailable"]) {
  test(`${status} treatment fails closed to SKIP with prediction scoring fallback`, () => {
    const decision = failClosedTreatmentDecision({
      candidate_id: `candidate-${status}`,
      track: "0B",
      status,
      control_p_yes: 0.42,
      input_hash: sha256Hex("input"),
    });
    assert.equal(decision.action, "SKIP");
    assert.equal(decision.p_yes, 0.42);
    assert.equal(decision.incremental_cost_usd, 0);
  });
}

test("0A fail-closed treatment does not invent a forecast", () => {
  const decision = failClosedTreatmentDecision({
    candidate_id: "candidate-0a",
    track: "0A",
    status: "timeout",
    input_hash: sha256Hex("input"),
  });
  assert.equal(decision.action, "SKIP");
  assert.equal(decision.p_yes, null);
});
