import test from "node:test";
import assert from "node:assert/strict";
import { assertPairedCandidates, brierScore, brierSkillScore, evaluatePairedForecasts } from "../src/evaluator.mjs";

test("paired evaluator rejects missing and extra candidates", () => {
  const two = [{ candidate_id: "a" }, { candidate_id: "b" }];
  const one = [{ candidate_id: "a" }];
  assert.throws(() => assertPairedCandidates(two, one), /length mismatch/u);
  assert.throws(() => assertPairedCandidates(one, two), /length mismatch/u);
});

test("paired evaluator rejects a mismatched candidate ID", () => {
  assert.throws(
    () => assertPairedCandidates([{ candidate_id: "a" }], [{ candidate_id: "b" }]),
    /Candidate ID mismatch/u,
  );
});

test("Brier Score returns a known expected value", () => {
  assert.ok(Math.abs(brierScore([0.9, 0.2, 0.6], [1, 0, 1]) - 0.07) < 1e-12);
});

test("Brier Skill Score returns a known expected value", () => {
  assert.ok(Math.abs(brierSkillScore(0.04, 0.25) - 0.84) < 1e-12);
});

test("paired forecast evaluator returns control/treatment metrics only for aligned candidates", () => {
  const control = [{ candidate_id: "a", p_yes: 0.5 }, { candidate_id: "b", p_yes: 0.5 }];
  const treatment = [{ candidate_id: "a", p_yes: 0.8 }, { candidate_id: "b", p_yes: 0.2 }];
  const outcomes = [{ candidate_id: "a", outcome: 1 }, { candidate_id: "b", outcome: 0 }];
  const result = evaluatePairedForecasts(control, treatment, outcomes);
  assert.equal(result.paired_count, 2);
  assert.ok(Math.abs(result.control_brier - 0.25) < 1e-12);
  assert.ok(Math.abs(result.treatment_brier - 0.04) < 1e-12);
  assert.ok(Math.abs(result.brier_skill_score - 0.84) < 1e-12);
});
