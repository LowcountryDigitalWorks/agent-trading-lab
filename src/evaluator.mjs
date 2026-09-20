function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertProbability(value, label) {
  assert(typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1, `${label} must be a probability in [0, 1]`);
}

export function assertPairedCandidates(control, treatment) {
  assert(Array.isArray(control) && Array.isArray(treatment), "Control and treatment must be arrays");
  if (control.length !== treatment.length) {
    throw new Error(`Candidate-set length mismatch: control=${control.length}, treatment=${treatment.length}`);
  }
  for (let index = 0; index < control.length; index += 1) {
    const controlId = control[index]?.candidate_id;
    const treatmentId = treatment[index]?.candidate_id;
    assert(typeof controlId === "string" && controlId.length > 0, `Control candidate_id missing at index ${index}`);
    assert(typeof treatmentId === "string" && treatmentId.length > 0, `Treatment candidate_id missing at index ${index}`);
    if (controlId !== treatmentId) throw new Error(`Candidate ID mismatch at index ${index}: control=${controlId}, treatment=${treatmentId}`);
  }
  return true;
}

export function brierScore(probabilities, outcomes) {
  assert(Array.isArray(probabilities) && Array.isArray(outcomes), "Probabilities and outcomes must be arrays");
  assert(probabilities.length > 0, "Brier Score requires at least one observation");
  assert(probabilities.length === outcomes.length, "Brier Score inputs must have equal length");
  let total = 0;
  for (let index = 0; index < probabilities.length; index += 1) {
    const probability = probabilities[index];
    const outcome = outcomes[index];
    assertProbability(probability, `probabilities[${index}]`);
    assert(outcome === 0 || outcome === 1, `outcomes[${index}] must be 0 or 1`);
    total += (probability - outcome) ** 2;
  }
  return total / probabilities.length;
}

export function brierSkillScore(treatmentBrier, controlBrier) {
  assert(typeof treatmentBrier === "number" && Number.isFinite(treatmentBrier) && treatmentBrier >= 0, "Treatment Brier Score must be non-negative");
  assert(typeof controlBrier === "number" && Number.isFinite(controlBrier) && controlBrier > 0, "Control Brier Score must be greater than zero for Brier Skill Score");
  return 1 - treatmentBrier / controlBrier;
}

export function evaluatePairedForecasts(control, treatment, outcomes) {
  assertPairedCandidates(control, treatment);
  assert(Array.isArray(outcomes), "Outcomes must be an array");
  if (outcomes.length !== control.length) throw new Error(`Outcome-set length mismatch: outcomes=${outcomes.length}, candidates=${control.length}`);

  const controlProbabilities = [];
  const treatmentProbabilities = [];
  const resolved = [];
  for (let index = 0; index < control.length; index += 1) {
    const outcome = outcomes[index];
    if (outcome?.candidate_id !== control[index].candidate_id) throw new Error(`Outcome candidate ID mismatch at index ${index}`);
    assertProbability(control[index].p_yes, `control[${index}].p_yes`);
    assertProbability(treatment[index].p_yes, `treatment[${index}].p_yes`);
    assert(outcome.outcome === 0 || outcome.outcome === 1, `outcomes[${index}].outcome must be 0 or 1`);
    controlProbabilities.push(control[index].p_yes);
    treatmentProbabilities.push(treatment[index].p_yes);
    resolved.push(outcome.outcome);
  }

  const controlBrier = brierScore(controlProbabilities, resolved);
  const treatmentBrier = brierScore(treatmentProbabilities, resolved);
  return {
    paired_count: control.length,
    control_brier: controlBrier,
    treatment_brier: treatmentBrier,
    brier_skill_score: brierSkillScore(treatmentBrier, controlBrier),
  };
}
