import { canonicalSerialize, sha256Hex } from "./canonical.mjs";
import {
  DeterministicCryptoStructProofRunner,
} from "./cryptostruct-proof-runner.mjs";
import {
  QUALITY_GATE,
  cryptoStructSourceContractHash,
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

const SHA256_HEX = /^[a-f0-9]{64}$/u;
const PROOF_RUN_ID = /^release-0\.5\.2-stage2-[a-z0-9][a-z0-9.-]*$/u;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function positiveInteger(value, label) {
  assert(Number.isInteger(value) && value > 0, \`\${label} must be a positive integer\`);
  return value;
}

function parsePositiveInteger(value, label) {
  const parsed = Number(value);
  return positiveInteger(parsed, label);
}

function exact(value, expected, label) {
  assert(value === expected, \`\${label} mismatch\`);
}

function validSha(value, label) {
  assert(typeof value === "string" && SHA256_HEX.test(value), \`\${label} must be SHA-256 hex\`);
  return value;
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

  return Object.freeze({
    actual_runner_commit: input.actual_runner_commit,
    authorized_runner_commit: input.authorized_runner_commit,
    proof_run_id: input.proof_run_id,
    ...hashes,
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

function defaultSemanticMapping() {
  return Object.freeze({
    status: "semantic_mapping_unproven",
    category: null,
  });
}

function countTerminal(summary, status) {
  summary.terminal_status_counts[status] = (summary.terminal_status_counts[status] ?? 0) + 1;
}

function terminalSuccess(result, summary) {
  countTerminal(summary, result.terminal_status);
  return result.terminal_status === "SUCCESS";
}

export async function executeRelease052LiveProof({
  outputDir,
  authority,
  invokeTool,
  semanticMapper = defaultSemanticMapping,
}) {
  const validated = validateRelease052LiveAuthority(authority);
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
  const summary = {
    discovery_attempts: 0,
    discovery_successes: 0,
    selected_candidates: 0,
    instrument_attempts: 0,
    instrument_successes: 0,
    instrument_ineligible: 0,
    snapshot_attempts: 0,
    snapshot_successes: 0,
    quality_pass: 0,
    quality_reject: 0,
    semantic_mapping_verified: 0,
    semantic_mapping_unproven: 0,
    terminal_status_counts: {},
  };

  const discoveryResults = [];
  for (const discovery of RELEASE052_STAGE2_DISCOVERY_PLAN) {
    const result = await runner.executeCall("search_instruments", { ...discovery });
    summary.discovery_attempts += 1;
    if (terminalSuccess(result, summary)) summary.discovery_successes += 1;
    discoveryResults.push(result);
  }

  const candidates = selectRelease052DeepProbeCandidates(discoveryResults);
  summary.selected_candidates = candidates.length;

  for (const candidate of candidates) {
    const instrumentId = candidate.instrument_id;
    const instrumentResult = await runner.executeCall(
      "get_instrument",
      { instrument_id: Number(instrumentId) },
      { instrumentId },
    );
    summary.instrument_attempts += 1;
    if (!terminalSuccess(instrumentResult, summary)) continue;
    summary.instrument_successes += 1;

    if (!isEligibleInstrument(instrumentResult.parsed)) {
      summary.instrument_ineligible += 1;
      continue;
    }

    const mapping = await semanticMapper(Object.freeze({
      instrument: instrumentResult.parsed,
      candidate,
    }));
    if (mapping?.status === "VERIFIED") summary.semantic_mapping_verified += 1;
    else summary.semantic_mapping_unproven += 1;

    const snapshot = await runner.executeCall(
      "get_market_snapshot",
      { instrument_id: Number(instrumentId) },
      { instrumentId },
    );
    summary.snapshot_attempts += 1;
    if (!terminalSuccess(snapshot, summary)) continue;
    summary.snapshot_successes += 1;

    const quality = release052SnapshotQuality(snapshot.parsed);
    if (quality.pass) summary.quality_pass += 1;
    else summary.quality_reject += 1;
  }

  runner.close();
  const nonSuccess = Object.entries(summary.terminal_status_counts)
    .filter(([status]) => status !== "SUCCESS")
    .reduce((total, [, count]) => total + count, 0);

  let classification = "QUALIFIED";
  if (nonSuccess > 0) classification = "BLOCKED";
  else if (
    summary.selected_candidates === 0
    || summary.snapshot_successes === 0
    || summary.semantic_mapping_verified === 0
    || summary.quality_pass === 0
  ) classification = "INSUFFICIENT";

  return Object.freeze({
    classification,
    summary: Object.freeze({
      ...summary,
      terminal_status_counts: Object.freeze({ ...summary.terminal_status_counts }),
    }),
  });
}
