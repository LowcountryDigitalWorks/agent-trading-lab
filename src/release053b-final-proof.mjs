import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { canonicalSerialize, isSha256Hex, sha256Hex } from "./canonical.mjs";
import {
  DeterministicCryptoStructProofRunner,
  PROOF_CALL_TERMINAL_STATUSES,
  finalizeProofArtifacts,
  parseProofCallLedgerJsonl,
  validateProofCallLedger,
} from "./cryptostruct-proof-runner.mjs";
import {
  PHASE0B_ALLOWED_CATEGORIES,
  cryptoStructSourceContractHash,
  validatePolymarketBinaryOrientation,
} from "./cryptostruct-source.mjs";
import {
  RELEASE053A_SCHEMA_DIAGNOSTIC_VERSION,
  classifyRelease053FutureObservation,
  diagnoseRelease053ToolSchema,
  mapRelease053EventFirstInstrument,
  release053ParserContractHash,
  release053QualityFeasibilityDesignHash,
  release053SnapshotQuality,
  selectRelease053EventFirstSemanticCandidates,
  validateRelease053SchemaDiagnostic,
} from "./release053a-qualification-design.mjs";
import {
  release053bCategoryCounts,
  release053bEventFirstQueryPlan,
  release053bEventUniverseHash,
  release053bQueryPlanHash,
  release053bSearchCalls,
  release053bSemanticBundleHash,
  validateRelease053bEventUniverse,
} from "./release053b-event-universe.mjs";

export const RELEASE053B_FINAL_PROOF_SUMMARY_SCHEMA =
  "release053-final-proof-summary.v1";
export const RELEASE053B_FINAL_PROOF_MANIFEST_SCHEMA =
  "release053-final-proof-manifest.v1";
export const RELEASE053B_WORKFLOW_IDENTITY =
  ".github/workflows/release053-final-source-proof.yml";

export const RELEASE053B_LIMITS = Object.freeze({
  max_search_calls: 8,
  max_get_instrument_calls: 40,
  max_snapshot_calls: 30,
  max_total_attempts: 78,
  max_unique_candidates: 80,
  per_event_snapshot_cap: 1,
  retries: 0,
  per_call_timeout_ms: 10_000,
  whole_proof_timeout_ms: 900_000,
});

const PROOF_RUN_ID = /^release-0\.5\.3-final-[a-z0-9][a-z0-9.-]*$/u;
const QUALITY_REASONS = Object.freeze([
  "low_trades_60m",
  "low_turnover_60m",
  "low_top1_depth",
  "invalid_or_wide_spread",
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function plain(value, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value;
}

function positiveInteger(value, label) {
  assert(Number.isInteger(value) && value > 0, `${label} must be a positive integer`);
  return value;
}

function nonNegativeInteger(value, label) {
  assert(Number.isInteger(value) && value >= 0, `${label} must be a non-negative integer`);
  return value;
}

function nonEmpty(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a non-empty string`);
  return value.trim();
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

async function durableWriteJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  const handle = await open(temporary, "w");
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
}

async function durableCreateEmpty(path) {
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, "wx");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function durableAppendLine(path, line) {
  const handle = await open(path, "a");
  try {
    await handle.writeFile(line, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function paths(outputDir) {
  return {
    diagnostics: join(outputDir, "sanitized-schema-diagnostics.jsonl"),
    summary: join(outputDir, "proof-summary.json"),
    releaseManifest: join(outputDir, "release053-proof-manifest.json"),
    releaseArtifactHash: join(outputDir, "release053-artifact-hash.txt"),
    baseManifest: join(outputDir, "proof-manifest.json"),
    ledger: join(outputDir, "sanitized-call-ledger.jsonl"),
  };
}

export function release053bDiagnosticContractHash() {
  return sha256Hex(canonicalSerialize({
    schema_version: RELEASE053A_SCHEMA_DIAGNOSTIC_VERSION,
    parser_contract_hashes: {
      search_instruments: release053ParserContractHash("search_instruments"),
      get_instrument: release053ParserContractHash("get_instrument"),
      get_market_snapshot: release053ParserContractHash("get_market_snapshot"),
    },
    retained_file: "sanitized-schema-diagnostics.jsonl",
    raw_values_retained: false,
    raw_unexpected_field_names_retained: false,
  }));
}

export function release053bFreezeSurface() {
  validateRelease053bEventUniverse();
  const searchCalls = release053bSearchCalls();
  assert(searchCalls.length === RELEASE053B_LIMITS.max_search_calls, "Release 0.5.3B search count mismatch");
  return deepFreeze({
    source_contract_hash: cryptoStructSourceContractHash(),
    event_universe_hash: release053bEventUniverseHash(),
    query_plan_hash: release053bQueryPlanHash(),
    semantic_bundle_hash: release053bSemanticBundleHash(),
    quality_screen_config_hash: release053QualityFeasibilityDesignHash(),
    diagnostic_contract_hash: release053bDiagnosticContractHash(),
    workflow_identity: RELEASE053B_WORKFLOW_IDENTITY,
    ...RELEASE053B_LIMITS,
  });
}

export function release053bRunnerSelectorConfig() {
  const freeze = release053bFreezeSurface();
  return deepFreeze({
    version: "release-0.5.3b-final-source-proof-selector.v1",
    event_universe_hash: freeze.event_universe_hash,
    semantic_bundle_hash: freeze.semantic_bundle_hash,
    quality_screen_config_hash: freeze.quality_screen_config_hash,
    diagnostic_contract_hash: freeze.diagnostic_contract_hash,
    candidate_order: "frozen-query-order-provider-hit-order-first-instrument-id",
    semantic_requirement: "exact-event-first-verified-source-mapping-record",
    max_get_instrument_calls: RELEASE053B_LIMITS.max_get_instrument_calls,
    max_snapshot_calls: RELEASE053B_LIMITS.max_snapshot_calls,
    per_event_snapshot_cap: RELEASE053B_LIMITS.per_event_snapshot_cap,
    first_quality_reject: "INSUFFICIENT_STOP",
    retry: false,
  });
}

function parseExpectedInteger(value, label) {
  return positiveInteger(Number(value), label);
}

function expectedSha(value, label) {
  assert(isSha256Hex(value), `${label} must be SHA-256 hex`);
  return value;
}

export function validateRelease053bAuthority(input) {
  plain(input, "Release053B authority");
  const freeze = release053bFreezeSurface();
  nonEmpty(input.actual_runner_commit, "actual_runner_commit");
  nonEmpty(input.authorized_runner_commit, "authorized_runner_commit");
  assert(input.actual_runner_commit === input.authorized_runner_commit, "runner commit mismatch");
  assert(PROOF_RUN_ID.test(input.proof_run_id), "invalid proof_run_id");
  assert(PROOF_RUN_ID.test(input.authorized_proof_run_id), "invalid authorized_proof_run_id");
  assert(input.proof_run_id === input.authorized_proof_run_id, "proof_run_id mismatch");

  const hashes = [
    ["expected_source_contract_hash", freeze.source_contract_hash],
    ["expected_event_universe_hash", freeze.event_universe_hash],
    ["expected_query_plan_hash", freeze.query_plan_hash],
    ["expected_semantic_bundle_hash", freeze.semantic_bundle_hash],
    ["expected_quality_screen_config_hash", freeze.quality_screen_config_hash],
    ["expected_diagnostic_contract_hash", freeze.diagnostic_contract_hash],
  ];
  for (const [field, actual] of hashes) {
    expectedSha(input[field], field);
    assert(input[field] === actual, `${field} mismatch`);
  }

  const limits = [
    ["expected_max_search_calls", RELEASE053B_LIMITS.max_search_calls],
    ["expected_max_get_instrument_calls", RELEASE053B_LIMITS.max_get_instrument_calls],
    ["expected_max_snapshot_calls", RELEASE053B_LIMITS.max_snapshot_calls],
    ["expected_max_total_attempts", RELEASE053B_LIMITS.max_total_attempts],
    ["expected_max_unique_candidates", RELEASE053B_LIMITS.max_unique_candidates],
    ["expected_per_call_timeout_ms", RELEASE053B_LIMITS.per_call_timeout_ms],
    ["expected_whole_proof_timeout_ms", RELEASE053B_LIMITS.whole_proof_timeout_ms],
  ];
  for (const [field, actual] of limits) {
    assert(parseExpectedInteger(input[field], field) === actual, `${field} mismatch`);
  }

  assert(
    input.expected_workflow_identity === RELEASE053B_WORKFLOW_IDENTITY,
    "workflow identity mismatch",
  );

  return deepFreeze({
    ...structuredClone(input),
    ...freeze,
  });
}

export function parseRelease053DiagnosticsJsonl(content) {
  assert(typeof content === "string", "diagnostics JSONL must be a string");
  const lines = content.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  return lines.map((line, index) => {
    try {
      const diagnostic = JSON.parse(line);
      validateRelease053SchemaDiagnostic(diagnostic);
      return diagnostic;
    } catch (error) {
      throw new Error(`invalid diagnostics JSONL at line ${index + 1}: ${error.message}`);
    }
  });
}

export function release053bDiagnosticsHash(records) {
  assert(Array.isArray(records), "diagnostics records must be an array");
  for (const record of records) validateRelease053SchemaDiagnostic(record);
  return sha256Hex(canonicalSerialize(records));
}

export async function readRelease053Diagnostics(outputDir) {
  const content = await readFile(paths(outputDir).diagnostics, "utf8");
  return deepFreeze(parseRelease053DiagnosticsJsonl(content));
}

class SanitizedSchemaDiagnosticLedger {
  constructor(path) {
    this.path = path;
  }

  static async createNew(path) {
    await durableCreateEmpty(path);
    return new SanitizedSchemaDiagnosticLedger(path);
  }

  async append({ tool, parsedPayload, proofRunId, callSequence }) {
    const diagnostic = diagnoseRelease053ToolSchema({
      tool,
      actualPayload: parsedPayload,
      proofRunId,
      callSequence,
    });
    assert(diagnostic !== null, "strict parser failed but diagnostic found no schema mismatch");
    validateRelease053SchemaDiagnostic(diagnostic);
    await durableAppendLine(this.path, `${canonicalSerialize(diagnostic)}\n`);
    return diagnostic;
  }
}

function emptyTerminalCounts() {
  return Object.fromEntries(PROOF_CALL_TERMINAL_STATUSES.map((status) => [status, 0]));
}

function emptyCategoryCounts() {
  return Object.fromEntries(PHASE0B_ALLOWED_CATEGORIES.map((category) => [category, 0]));
}

function newSummary(validated) {
  return {
    schema_version: RELEASE053B_FINAL_PROOF_SUMMARY_SCHEMA,
    proof_run_id: validated.proof_run_id,
    runner_commit: validated.actual_runner_commit,
    source_contract_hash: validated.source_contract_hash,
    event_universe_hash: validated.event_universe_hash,
    query_plan_hash: validated.query_plan_hash,
    semantic_bundle_hash: validated.semantic_bundle_hash,
    quality_screen_config_hash: validated.quality_screen_config_hash,
    diagnostic_contract_hash: validated.diagnostic_contract_hash,
    call_budget: {
      search_attempts: 0,
      get_instrument_attempts: 0,
      snapshot_attempts: 0,
      total_attempts: 0,
      retries: 0,
    },
    discovery: {
      successes: 0,
      unique_discovered_candidates: 0,
      selected_candidates: 0,
    },
    semantic: {
      verified_unique_events: 0,
      zero_match_unproven: 0,
      ambiguous_match_unproven: 0,
      other_unproven: 0,
    },
    snapshot: {
      successes: 0,
      evaluable_snapshots: 0,
    },
    quality: {
      passes: 0,
      rejects: 0,
      rejection_reason_counts: Object.fromEntries(QUALITY_REASONS.map((reason) => [reason, 0])),
    },
    category: {
      verified_event_counts: emptyCategoryCounts(),
      quality_pass_counts: emptyCategoryCounts(),
    },
    failures: {
      source: 0,
      parser: 0,
      accounting: 0,
      evidence_integrity: 0,
    },
    terminal_status_counts: emptyTerminalCounts(),
    classification: "BLOCKED",
  };
}

function validateCountMap(map, keys, label) {
  closedKeys(map, keys, label);
  for (const key of keys) nonNegativeInteger(map[key], `${label}.${key}`);
}

export function validateRelease053bProofSummary(summary) {
  closedKeys(summary, [
    "schema_version",
    "proof_run_id",
    "runner_commit",
    "source_contract_hash",
    "event_universe_hash",
    "query_plan_hash",
    "semantic_bundle_hash",
    "quality_screen_config_hash",
    "diagnostic_contract_hash",
    "call_budget",
    "discovery",
    "semantic",
    "snapshot",
    "quality",
    "category",
    "failures",
    "terminal_status_counts",
    "classification",
  ], "Release053BProofSummary");
  assert(summary.schema_version === RELEASE053B_FINAL_PROOF_SUMMARY_SCHEMA, "Release053BProofSummary schema mismatch");
  nonEmpty(summary.proof_run_id, "summary.proof_run_id");
  nonEmpty(summary.runner_commit, "summary.runner_commit");
  for (const field of [
    "source_contract_hash",
    "event_universe_hash",
    "query_plan_hash",
    "semantic_bundle_hash",
    "quality_screen_config_hash",
    "diagnostic_contract_hash",
  ]) assert(isSha256Hex(summary[field]), `summary.${field} must be SHA-256 hex`);

  closedKeys(summary.call_budget, [
    "search_attempts", "get_instrument_attempts", "snapshot_attempts", "total_attempts", "retries",
  ], "summary.call_budget");
  for (const value of Object.values(summary.call_budget)) nonNegativeInteger(value, "summary.call_budget count");
  assert(
    summary.call_budget.total_attempts
      === summary.call_budget.search_attempts
        + summary.call_budget.get_instrument_attempts
        + summary.call_budget.snapshot_attempts,
    "summary total attempt accounting mismatch",
  );
  assert(summary.call_budget.search_attempts <= RELEASE053B_LIMITS.max_search_calls, "search call ceiling exceeded");
  assert(summary.call_budget.get_instrument_attempts <= RELEASE053B_LIMITS.max_get_instrument_calls, "get_instrument ceiling exceeded");
  assert(summary.call_budget.snapshot_attempts <= RELEASE053B_LIMITS.max_snapshot_calls, "snapshot ceiling exceeded");
  assert(summary.call_budget.total_attempts <= RELEASE053B_LIMITS.max_total_attempts, "total call ceiling exceeded");
  assert(summary.call_budget.retries === 0, "retries are forbidden");

  closedKeys(summary.discovery, ["successes", "unique_discovered_candidates", "selected_candidates"], "summary.discovery");
  for (const value of Object.values(summary.discovery)) nonNegativeInteger(value, "summary.discovery count");

  closedKeys(summary.semantic, [
    "verified_unique_events", "zero_match_unproven", "ambiguous_match_unproven", "other_unproven",
  ], "summary.semantic");
  for (const value of Object.values(summary.semantic)) nonNegativeInteger(value, "summary.semantic count");

  closedKeys(summary.snapshot, ["successes", "evaluable_snapshots"], "summary.snapshot");
  for (const value of Object.values(summary.snapshot)) nonNegativeInteger(value, "summary.snapshot count");
  assert(summary.snapshot.evaluable_snapshots <= summary.semantic.verified_unique_events, "evaluable snapshots exceed VERIFIED events");
  assert(summary.snapshot.evaluable_snapshots <= RELEASE053B_LIMITS.max_snapshot_calls, "evaluable snapshot ceiling exceeded");

  closedKeys(summary.quality, ["passes", "rejects", "rejection_reason_counts"], "summary.quality");
  nonNegativeInteger(summary.quality.passes, "summary.quality.passes");
  nonNegativeInteger(summary.quality.rejects, "summary.quality.rejects");
  validateCountMap(summary.quality.rejection_reason_counts, QUALITY_REASONS, "summary.quality.rejection_reason_counts");
  assert(
    summary.quality.passes + summary.quality.rejects === summary.snapshot.evaluable_snapshots,
    "quality observation accounting mismatch",
  );

  closedKeys(summary.category, ["verified_event_counts", "quality_pass_counts"], "summary.category");
  validateCountMap(summary.category.verified_event_counts, PHASE0B_ALLOWED_CATEGORIES, "summary.category.verified_event_counts");
  validateCountMap(summary.category.quality_pass_counts, PHASE0B_ALLOWED_CATEGORIES, "summary.category.quality_pass_counts");

  closedKeys(summary.failures, ["source", "parser", "accounting", "evidence_integrity"], "summary.failures");
  for (const value of Object.values(summary.failures)) nonNegativeInteger(value, "summary.failures count");
  validateCountMap(summary.terminal_status_counts, PROOF_CALL_TERMINAL_STATUSES, "summary.terminal_status_counts");
  assert(["BLOCKED", "INSUFFICIENT", "TECHNICALLY_VIABLE"].includes(summary.classification), "summary classification invalid");
  return summary;
}

export async function writeRelease053bProofSummary(outputDir, summary) {
  validateRelease053bProofSummary(summary);
  await durableWriteJson(paths(outputDir).summary, summary);
  return deepFreeze(structuredClone(summary));
}

function incrementToolBudget(summary, tool) {
  if (tool === "search_instruments") {
    assert(summary.call_budget.search_attempts < RELEASE053B_LIMITS.max_search_calls, "search call budget exhausted");
    summary.call_budget.search_attempts += 1;
  } else if (tool === "get_instrument") {
    assert(summary.call_budget.get_instrument_attempts < RELEASE053B_LIMITS.max_get_instrument_calls, "get_instrument call budget exhausted");
    summary.call_budget.get_instrument_attempts += 1;
  } else if (tool === "get_market_snapshot") {
    assert(summary.call_budget.snapshot_attempts < RELEASE053B_LIMITS.max_snapshot_calls, "snapshot call budget exhausted");
    summary.call_budget.snapshot_attempts += 1;
  } else {
    throw new Error(`unsupported Release 0.5.3B tool: ${tool}`);
  }
  summary.call_budget.total_attempts += 1;
  assert(summary.call_budget.total_attempts <= RELEASE053B_LIMITS.max_total_attempts, "total call budget exhausted");
}

function terminalSuccess(result, summary) {
  const status = result.terminal_status;
  if (Object.hasOwn(summary.terminal_status_counts, status)) {
    summary.terminal_status_counts[status] += 1;
  }
  if (status === "SUCCESS") return true;
  if (status === "PARSE_ERROR") summary.failures.parser += 1;
  else summary.failures.source += 1;
  if (result.diagnostic_error) summary.failures.evidence_integrity += 1;
  return false;
}

function summaryObservation(summary, { planExhausted }) {
  return {
    pre_dispatch_valid: true,
    source_failure_count: summary.failures.source,
    parser_failure_count: summary.failures.parser,
    accounting_failure_count:
      summary.failures.accounting + summary.failures.evidence_integrity,
    plan_exhausted: planExhausted,
    verified_unique_events: summary.semantic.verified_unique_events,
    evaluable_snapshots: summary.snapshot.evaluable_snapshots,
    quality_passes: summary.quality.passes,
    quality_rejects: summary.quality.rejects,
    retry_count: summary.call_budget.retries,
  };
}

function classifySummary(summary, { planExhausted }) {
  if (
    summary.failures.source > 0
    || summary.failures.parser > 0
    || summary.failures.accounting > 0
    || summary.failures.evidence_integrity > 0
  ) return "BLOCKED";
  try {
    return classifyRelease053FutureObservation(summaryObservation(summary, { planExhausted }));
  } catch {
    summary.failures.accounting += 1;
    return "BLOCKED";
  }
}

function eligibleInstrument(instrument) {
  if (
    instrument?.venue !== "polymarket"
    || instrument?.instrument_class !== "prediction"
    || instrument?.state !== "open"
  ) return false;
  return validatePolymarketBinaryOrientation(instrument).valid;
}

function snapshotMatchesInstrument(snapshot, instrument) {
  return (
    String(snapshot?.instrument_id) === String(instrument?.instrument_id)
    && snapshot?.code === instrument?.code
    && snapshot?.venue === instrument?.venue
  );
}

export async function executeRelease053bFinalProof({
  outputDir,
  authority,
  invokeTool,
  clock = () => new Date().toISOString(),
  nowMs = () => Date.now(),
}) {
  const validated = validateRelease053bAuthority(authority);
  const summary = newSummary(validated);
  const p = paths(outputDir);
  await mkdir(outputDir, { recursive: true });

  const runnerInput = {
    outputDir,
    proof_run_id: validated.proof_run_id,
    source_contract_hash: validated.source_contract_hash,
    runner_commit: validated.actual_runner_commit,
    runner_version: "0.5.3",
    max_attempted_calls: RELEASE053B_LIMITS.max_total_attempts,
    max_unique_candidates: RELEASE053B_LIMITS.max_unique_candidates,
    per_call_timeout_ms: RELEASE053B_LIMITS.per_call_timeout_ms,
    whole_proof_timeout_ms: RELEASE053B_LIMITS.whole_proof_timeout_ms,
    discovery_plan: release053bSearchCalls(),
    selector_config: release053bRunnerSelectorConfig(),
    clock,
    nowMs,
  };
  if (invokeTool !== undefined) runnerInput.invokeTool = invokeTool;

  const runner = await DeterministicCryptoStructProofRunner.create(runnerInput);
  const diagnostics = await SanitizedSchemaDiagnosticLedger.createNew(p.diagnostics);
  runner.onSourceContractParseError = (input) => diagnostics.append(input);

  try {
    await writeRelease053bProofSummary(outputDir, summary);
    const discoveryResults = [];
    for (const query of release053bSearchCalls()) {
      incrementToolBudget(summary, "search_instruments");
      const result = await runner.executeCall("search_instruments", { ...query });
      const success = terminalSuccess(result, summary);
      if (success) summary.discovery.successes += 1;
      summary.discovery.unique_discovered_candidates = runner.ledgerState().unique_candidate_count;
      await writeRelease053bProofSummary(outputDir, summary);
      if (!success) {
        summary.classification = "BLOCKED";
        await writeRelease053bProofSummary(outputDir, summary);
        runner.close();
        return deepFreeze({ classification: summary.classification, summary: structuredClone(summary) });
      }
      discoveryResults.push(result);
    }

    const plan = release053bEventFirstQueryPlan();
    const selection = selectRelease053EventFirstSemanticCandidates({
      plan,
      discoveryResults,
    });
    summary.discovery.selected_candidates = selection.selected.length;
    summary.semantic.zero_match_unproven += selection.no_match_count;
    summary.semantic.ambiguous_match_unproven += selection.ambiguous_match_count;
    await writeRelease053bProofSummary(outputDir, summary);

    if (selection.selected.length < 30) {
      summary.classification = "INSUFFICIENT";
      await writeRelease053bProofSummary(outputDir, summary);
      runner.close();
      return deepFreeze({ classification: summary.classification, summary: structuredClone(summary) });
    }

    const verifiedEvents = new Set();
    for (const candidate of selection.selected) {
      if (summary.semantic.verified_unique_events >= 30) break;
      incrementToolBudget(summary, "get_instrument");
      const instrumentResult = await runner.executeCall(
        "get_instrument",
        { instrument_id: Number(candidate.instrument_id) },
        { instrumentId: candidate.instrument_id },
      );
      if (!terminalSuccess(instrumentResult, summary)) {
        summary.classification = "BLOCKED";
        await writeRelease053bProofSummary(outputDir, summary);
        runner.close();
        return deepFreeze({ classification: summary.classification, summary: structuredClone(summary) });
      }

      if (!eligibleInstrument(instrumentResult.parsed)) {
        summary.semantic.other_unproven += 1;
        await writeRelease053bProofSummary(outputDir, summary);
        continue;
      }

      const mapping = mapRelease053EventFirstInstrument({
        plan,
        instrument: instrumentResult.parsed,
        mappingTimestamp: instrumentResult.terminal.completion_timestamp,
      });
      if (mapping.status !== "VERIFIED") {
        if (mapping.match_count === 0) summary.semantic.zero_match_unproven += 1;
        else if (mapping.match_count > 1) summary.semantic.ambiguous_match_unproven += 1;
        else summary.semantic.other_unproven += 1;
        await writeRelease053bProofSummary(outputDir, summary);
        continue;
      }
      if (verifiedEvents.has(mapping.event_id)) continue;
      verifiedEvents.add(mapping.event_id);
      summary.semantic.verified_unique_events += 1;
      summary.category.verified_event_counts[mapping.category] += 1;

      incrementToolBudget(summary, "get_market_snapshot");
      const snapshotResult = await runner.executeCall(
        "get_market_snapshot",
        { instrument_id: Number(candidate.instrument_id) },
        { instrumentId: candidate.instrument_id },
      );
      if (!terminalSuccess(snapshotResult, summary)) {
        summary.classification = "BLOCKED";
        await writeRelease053bProofSummary(outputDir, summary);
        runner.close();
        return deepFreeze({ classification: summary.classification, summary: structuredClone(summary) });
      }
      summary.snapshot.successes += 1;
      if (!snapshotMatchesInstrument(snapshotResult.parsed, instrumentResult.parsed)) {
        summary.failures.accounting += 1;
        summary.classification = "BLOCKED";
        await writeRelease053bProofSummary(outputDir, summary);
        runner.close();
        return deepFreeze({ classification: summary.classification, summary: structuredClone(summary) });
      }

      summary.snapshot.evaluable_snapshots += 1;
      const quality = release053SnapshotQuality(snapshotResult.parsed);
      if (quality.pass) {
        summary.quality.passes += 1;
        summary.category.quality_pass_counts[mapping.category] += 1;
      } else {
        summary.quality.rejects += 1;
        for (const reason of quality.reasons) summary.quality.rejection_reason_counts[reason] += 1;
      }

      summary.classification = classifySummary(summary, { planExhausted: false });
      await writeRelease053bProofSummary(outputDir, summary);

      if (summary.classification === "INSUFFICIENT") {
        runner.close();
        return deepFreeze({ classification: summary.classification, summary: structuredClone(summary) });
      }
      if (summary.classification === "BLOCKED") {
        runner.close();
        return deepFreeze({ classification: summary.classification, summary: structuredClone(summary) });
      }
      if (summary.classification === "TECHNICALLY_VIABLE") {
        runner.close();
        return deepFreeze({ classification: summary.classification, summary: structuredClone(summary) });
      }
    }

    summary.classification = classifySummary(summary, { planExhausted: true });
    await writeRelease053bProofSummary(outputDir, summary);
    runner.close();
    return deepFreeze({ classification: summary.classification, summary: structuredClone(summary) });
  } catch (error) {
    runner.close();
    summary.failures.accounting += 1;
    summary.classification = "BLOCKED";
    try {
      await writeRelease053bProofSummary(outputDir, summary);
    } catch {
      // Finalizer will still bind the durable ledger/diagnostics evidence.
    }
    throw error;
  }
}

function baseClassification(releaseClassification) {
  if (releaseClassification === "TECHNICALLY_VIABLE") return "QUALIFIED";
  if (releaseClassification === "INSUFFICIENT") return "INSUFFICIENT";
  return "BLOCKED";
}

export function validateRelease053bProofManifest(manifest) {
  closedKeys(manifest, [
    "schema_version",
    "proof_run_id",
    "runner_commit",
    "source_contract_hash",
    "event_universe_hash",
    "query_plan_hash",
    "semantic_bundle_hash",
    "quality_screen_config_hash",
    "diagnostic_contract_hash",
    "base_control_manifest_hash",
    "ledger_final_hash",
    "proof_summary_hash",
    "diagnostics_hash",
    "classification",
    "artifact_hash",
  ], "Release053BProofManifest");
  assert(manifest.schema_version === RELEASE053B_FINAL_PROOF_MANIFEST_SCHEMA, "Release053BProofManifest schema mismatch");
  nonEmpty(manifest.proof_run_id, "manifest.proof_run_id");
  nonEmpty(manifest.runner_commit, "manifest.runner_commit");
  for (const field of [
    "source_contract_hash",
    "event_universe_hash",
    "query_plan_hash",
    "semantic_bundle_hash",
    "quality_screen_config_hash",
    "diagnostic_contract_hash",
    "base_control_manifest_hash",
    "proof_summary_hash",
    "diagnostics_hash",
    "artifact_hash",
  ]) assert(isSha256Hex(manifest[field]), `manifest.${field} must be SHA-256 hex`);
  assert(manifest.ledger_final_hash === null || isSha256Hex(manifest.ledger_final_hash), "manifest.ledger_final_hash invalid");
  assert(["BLOCKED", "INSUFFICIENT", "TECHNICALLY_VIABLE"].includes(manifest.classification), "manifest classification invalid");
  const { artifact_hash: _artifactHash, ...material } = manifest;
  assert(manifest.artifact_hash === sha256Hex(canonicalSerialize(material)), "release053 artifact_hash mismatch");
  return manifest;
}

export async function finalizeRelease053bProofArtifacts(outputDir, { classification }) {
  assert(["BLOCKED", "INSUFFICIENT", "TECHNICALLY_VIABLE"].includes(classification), "invalid Release 0.5.3B classification");
  const p = paths(outputDir);
  const baseManifest = await finalizeProofArtifacts(outputDir, {
    classification: baseClassification(classification),
  });
  const summary = JSON.parse(await readFile(p.summary, "utf8"));
  validateRelease053bProofSummary(summary);
  assert(summary.classification === classification, "summary/final classification mismatch");

  const diagnosticRecords = await readRelease053Diagnostics(outputDir);
  const diagnosticsHash = release053bDiagnosticsHash(diagnosticRecords);
  const ledgerRecords = parseProofCallLedgerJsonl(await readFile(p.ledger, "utf8"));
  const ledgerValidation = validateProofCallLedger(ledgerRecords, {
    requireTerminalForEveryReservation: true,
  });
  assert(baseManifest.ledger_final_hash === ledgerValidation.last_record_hash, "base manifest ledger hash mismatch");

  const freeze = release053bFreezeSurface();
  const withoutArtifactHash = {
    schema_version: RELEASE053B_FINAL_PROOF_MANIFEST_SCHEMA,
    proof_run_id: summary.proof_run_id,
    runner_commit: summary.runner_commit,
    source_contract_hash: freeze.source_contract_hash,
    event_universe_hash: freeze.event_universe_hash,
    query_plan_hash: freeze.query_plan_hash,
    semantic_bundle_hash: freeze.semantic_bundle_hash,
    quality_screen_config_hash: freeze.quality_screen_config_hash,
    diagnostic_contract_hash: freeze.diagnostic_contract_hash,
    base_control_manifest_hash: sha256Hex(canonicalSerialize(baseManifest)),
    ledger_final_hash: ledgerValidation.last_record_hash,
    proof_summary_hash: sha256Hex(canonicalSerialize(summary)),
    diagnostics_hash: diagnosticsHash,
    classification,
  };
  const manifest = {
    ...withoutArtifactHash,
    artifact_hash: sha256Hex(canonicalSerialize(withoutArtifactHash)),
  };
  validateRelease053bProofManifest(manifest);
  await durableWriteJson(p.releaseManifest, manifest);
  await writeFile(p.releaseArtifactHash, `${manifest.artifact_hash}\n`, "utf8");
  return deepFreeze(manifest);
}
