import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalSerialize } from "../src/canonical.mjs";
import {
  parseGetMarketSnapshotResult,
  validateIndependentEventSpec,
} from "../src/cryptostruct-source.mjs";
import {
  release053EventFirstQueryPlanHash,
  release053EventFirstSemanticBundleHash,
} from "../src/release053a-qualification-design.mjs";
import {
  release053bCategoryCounts,
  release053bEventFirstQueryPlan,
  release053bEventUniverse,
  release053bEventUniverseHash,
  release053bIndependentEventEntries,
  release053bQueryPlanHash,
  release053bSearchCalls,
  release053bSemanticBundleHash,
  validateRelease053bEventUniverse,
} from "../src/release053b-event-universe.mjs";
import {
  RELEASE053B_LIMITS,
  RELEASE053B_WORKFLOW_IDENTITY,
  classifyRelease053bObservation,
  executeRelease053bFinalProof,
  finalizeRelease053bProofArtifacts,
  parseRelease053DiagnosticsJsonl,
  readRelease053Diagnostics,
  release053bDiagnosticContractHash,
  release053bDiagnosticsHash,
  release053bFreezeSurface,
  validateRelease053bAuthority,
  validateRelease053bProofManifest,
  validateRelease053bProofSummary,
} from "../src/release053b-final-proof.mjs";

const COMMIT = "a".repeat(40);
const PROOF_RUN_ID = "release-0.5.3-final-offline-synthetic-test";

function authority(overrides = {}) {
  const freeze = release053bFreezeSurface();
  return {
    actual_runner_commit: COMMIT,
    authorized_runner_commit: COMMIT,
    proof_run_id: PROOF_RUN_ID,
    authorized_proof_run_id: PROOF_RUN_ID,
    expected_source_contract_hash: freeze.source_contract_hash,
    expected_event_universe_hash: freeze.event_universe_hash,
    expected_query_plan_hash: freeze.query_plan_hash,
    expected_semantic_bundle_hash: freeze.semantic_bundle_hash,
    expected_quality_screen_config_hash: freeze.quality_screen_config_hash,
    expected_diagnostic_contract_hash: freeze.diagnostic_contract_hash,
    expected_max_search_calls: String(freeze.max_search_calls),
    expected_max_get_instrument_calls: String(freeze.max_get_instrument_calls),
    expected_max_snapshot_calls: String(freeze.max_snapshot_calls),
    expected_max_total_attempts: String(freeze.max_total_attempts),
    expected_max_unique_candidates: String(freeze.max_unique_candidates),
    expected_per_call_timeout_ms: String(freeze.per_call_timeout_ms),
    expected_whole_proof_timeout_ms: String(freeze.whole_proof_timeout_ms),
    expected_workflow_identity: RELEASE053B_WORKFLOW_IDENTITY,
    ...overrides,
  };
}

function envelope(payload, id) {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    result: { content: [{ type: "text", text: JSON.stringify(payload) }] },
  });
}

function searchPayload(hits) {
  return {
    total_matching: hits.length,
    showing: hits.length,
    hits: hits.map((hit) => ({
      instrument_id: Number(hit.id),
      code: hit.code,
      type: "prediction",
      venue: "polymarket",
      venue_name: "Polymarket",
      base: "POLYMARKET_BET",
      quote: "pUSD",
      state: "open",
      days_with_data: 10,
      first_day: "2026-09-01",
      last_day: "2026-09-25",
      total_bytes_compressed: 1000,
    })),
  };
}

function instrumentPayload(id, code) {
  return {
    instrument_id: Number(id),
    code,
    type: "prediction",
    venue: "polymarket",
    venue_name: "Polymarket",
    base: "POLYMARKET_BET",
    quote: "pUSD",
    state: "open",
    days_with_data: 10,
    first_day: "2026-09-01",
    last_day: "2026-09-25",
    total_bytes_compressed: 1000,
    listed_since: "2026-09-01",
  };
}

function snapshotPayload(id, code, overrides = {}) {
  return {
    instrument_id: Number(id),
    code,
    venue: "polymarket",
    as_of: "2026-09-25T16:00:00.000Z",
    price_last: overrides.price ?? 0.5,
    change_24h_pct: null,
    vwap_last_minute: null,
    last_60m: {
      turnover_usd: overrides.turnover ?? 250,
      turnover_buy_usd: null,
      turnover_sell_usd: null,
      trades: overrides.trades ?? 12,
      liquidations: null,
      spread_bps_avg: overrides.spread ?? 250,
      top1_depth_usd: {
        bid: overrides.bid ?? 100,
        ask: overrides.ask ?? 120,
      },
      top20_depth_usd: null,
    },
    last_24h: null,
  };
}

function fixtureWorld() {
  const entries = release053bIndependentEventEntries();
  const queryGroups = new Map();
  const instruments = new Map();
  let nextId = 1000;
  for (const entry of entries) {
    const query = entry.query_terms[0];
    const code = entry.semantic_aliases[0];
    const id = String(nextId++);
    if (!queryGroups.has(query)) queryGroups.set(query, []);
    queryGroups.get(query).push({ id, code });
    instruments.set(id, { code });
  }
  return { queryGroups, instruments };
}

function syntheticTransport({
  world = fixtureWorld(),
  snapshotOverrides = {},
  malformedSnapshotId = null,
  firstSearchHttpError = false,
  callLog = [],
} = {}) {
  let searchCount = 0;
  return async ({ tool, args, callSequence }) => {
    callLog.push({ tool, args: structuredClone(args) });
    if (tool === "search_instruments") {
      searchCount += 1;
      if (firstSearchHttpError && searchCount === 1) {
        return { httpStatus: 503, bodyText: "unavailable" };
      }
      const hits = world.queryGroups.get(args.q) ?? [];
      return { httpStatus: 200, bodyText: envelope(searchPayload(hits), callSequence) };
    }
    if (tool === "get_instrument") {
      const item = world.instruments.get(String(args.instrument_id));
      return {
        httpStatus: 200,
        bodyText: envelope(instrumentPayload(args.instrument_id, item.code), callSequence),
      };
    }
    const item = world.instruments.get(String(args.instrument_id));
    const payload = snapshotPayload(
      args.instrument_id,
      item.code,
      snapshotOverrides[String(args.instrument_id)] ?? {},
    );
    if (String(args.instrument_id) === String(malformedSnapshotId)) {
      payload.last_60m.trades = "DO-NOT-RETAIN-WRONG-TYPE-VALUE";
    }
    return { httpStatus: 200, bodyText: envelope(payload, callSequence) };
  };
}

async function tempDir(t) {
  const directory = await mkdtemp(join(tmpdir(), "release053b-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("0.5.3B real IndependentEventSpec universe contains 40 valid pre-source events", () => {
  const validation = validateRelease053bEventUniverse();
  assert.equal(validation.event_count, 40);
  assert.equal(validation.query_count, 8);
  const universe = release053bEventUniverse();
  assert.equal(universe.events.length, 40);
  for (const event of universe.events) {
    assert.equal(validateIndependentEventSpec(event), event);
    assert.equal(event.category, "WEATHER_CLIMATE");
    assert.match(event.resolution_reference, /^https:\/\/www\.ncei\.noaa\.gov\/access\/services\/data\/v1/u);
    assert.doesNotMatch(event.resolution_reference, /polymarket|kalshi|cryptostruct/iu);
  }
  assert.deepEqual(release053bCategoryCounts(), {
    WEATHER_CLIMATE: 40,
    MACROECONOMICS: 0,
    SCIENCE_TECHNOLOGY: 0,
    ENTERTAINMENT_CULTURE: 0,
  });
});

test("event universe, query plan, and semantic bundle are canonical and stable", () => {
  const universeHash = release053bEventUniverseHash();
  const plan = release053bEventFirstQueryPlan();
  assert.match(universeHash, /^[a-f0-9]{64}$/u);
  assert.equal(release053bQueryPlanHash(), release053EventFirstQueryPlanHash(plan));
  assert.equal(
    release053bSemanticBundleHash(),
    release053EventFirstSemanticBundleHash(plan),
  );
  assert.equal(release053bEventUniverseHash(), universeHash);
  assert.equal(canonicalSerialize(release053bEventUniverse()), canonicalSerialize(release053bEventUniverse()));
});

test("query plan freezes exactly eight provider-neutral searches", () => {
  assert.deepEqual(release053bSearchCalls(), [
    { q: "Atlanta daily high temperature", class: "prediction", venue: "polymarket", limit: 10 },
    { q: "Boston daily high temperature", class: "prediction", venue: "polymarket", limit: 10 },
    { q: "Chicago daily high temperature", class: "prediction", venue: "polymarket", limit: 10 },
    { q: "Los Angeles daily high temperature", class: "prediction", venue: "polymarket", limit: 10 },
    { q: "Miami daily high temperature", class: "prediction", venue: "polymarket", limit: 10 },
    { q: "New York City daily high temperature", class: "prediction", venue: "polymarket", limit: 10 },
    { q: "Phoenix daily high temperature", class: "prediction", venue: "polymarket", limit: 10 },
    { q: "Seattle daily high temperature", class: "prediction", venue: "polymarket", limit: 10 },
  ]);
});

test("freeze surface enforces 8/40/30/78, one snapshot/event, zero retries", () => {
  const freeze = release053bFreezeSurface();
  assert.deepEqual(
    {
      search: freeze.max_search_calls,
      instrument: freeze.max_get_instrument_calls,
      snapshot: freeze.max_snapshot_calls,
      total: freeze.max_total_attempts,
      perEvent: freeze.per_event_snapshot_cap,
      retries: freeze.retries,
    },
    { search: 8, instrument: 40, snapshot: 30, total: 78, perEvent: 1, retries: 0 },
  );
  assert.equal(freeze.max_unique_candidates, 80);
  assert.equal(freeze.workflow_identity, RELEASE053B_WORKFLOW_IDENTITY);
  assert.match(release053bDiagnosticContractHash(), /^[a-f0-9]{64}$/u);
});

test("all authority/hash/config mismatches fail before proof initialization", async (t) => {
  const outputDir = await tempDir(t);
  for (const patch of [
    { actual_runner_commit: "b".repeat(40) },
    { expected_event_universe_hash: "0".repeat(64) },
    { expected_query_plan_hash: "1".repeat(64) },
    { expected_semantic_bundle_hash: "2".repeat(64) },
    { expected_quality_screen_config_hash: "3".repeat(64) },
    { expected_diagnostic_contract_hash: "4".repeat(64) },
    { expected_max_search_calls: "9" },
    { expected_max_get_instrument_calls: "41" },
    { expected_max_snapshot_calls: "31" },
    { expected_max_total_attempts: "79" },
    { expected_workflow_identity: ".github/workflows/wrong.yml" },
  ]) {
    assert.throws(() => validateRelease053bAuthority(authority(patch)));
  }
  await assert.rejects(readFile(join(outputDir, "sanitized-call-ledger.jsonl"), "utf8"));
});

test("synthetic provider observations cannot mutate frozen universe/query/semantic hashes", async (t) => {
  const before = {
    universe: release053bEventUniverseHash(),
    plan: release053bQueryPlanHash(),
    semantic: release053bSemanticBundleHash(),
  };
  const outputDir = await tempDir(t);
  await executeRelease053bFinalProof({
    outputDir,
    authority: authority(),
    invokeTool: syntheticTransport(),
  });
  assert.deepEqual({
    universe: release053bEventUniverseHash(),
    plan: release053bQueryPlanHash(),
    semantic: release053bSemanticBundleHash(),
  }, before);
});

test("strict source parser remains strict", () => {
  const payload = snapshotPayload(1, "independent-alias");
  payload.unexpected_live_field = "DO-NOT-RETAIN";
  assert.throws(() => parseGetMarketSnapshotResult(payload), /unknown field/u);
});

test("exact 30/30 synthetic all-pass run is TECHNICALLY_VIABLE within 68 calls", async (t) => {
  const outputDir = await tempDir(t);
  const callLog = [];
  const result = await executeRelease053bFinalProof({
    outputDir,
    authority: authority(),
    invokeTool: syntheticTransport({ callLog }),
  });
  assert.equal(result.classification, "TECHNICALLY_VIABLE");
  assert.equal(result.summary.semantic.verified_unique_events, 30);
  assert.equal(result.summary.snapshot.evaluable_snapshots, 30);
  assert.equal(result.summary.quality.passes, 30);
  assert.equal(result.summary.quality.rejects, 0);
  assert.deepEqual(result.summary.call_budget, {
    search_attempts: 8,
    get_instrument_attempts: 30,
    snapshot_attempts: 30,
    total_attempts: 68,
    retries: 0,
  });
  assert.equal(callLog.filter((call) => call.tool === "get_market_snapshot").length, 30);
  assert.equal(new Set(
    callLog.filter((call) => call.tool === "get_market_snapshot")
      .map((call) => String(call.args.instrument_id)),
  ).size, 30);
  assert.equal(validateRelease053bProofSummary(result.summary), result.summary);
});

test("first quality rejection stops immediately with no rescue calls", async (t) => {
  const outputDir = await tempDir(t);
  const world = fixtureWorld();
  const firstId = [...world.instruments.keys()][0];
  const callLog = [];
  const result = await executeRelease053bFinalProof({
    outputDir,
    authority: authority(),
    invokeTool: syntheticTransport({
      world,
      snapshotOverrides: { [firstId]: { trades: 1 } },
      callLog,
    }),
  });
  assert.equal(result.classification, "INSUFFICIENT");
  assert.equal(result.summary.quality.rejects, 1);
  assert.equal(result.summary.snapshot.evaluable_snapshots, 1);
  assert.equal(result.summary.call_budget.total_attempts, 10);
  assert.equal(callLog.filter((call) => call.tool === "get_instrument").length, 1);
  assert.equal(callLog.filter((call) => call.tool === "get_market_snapshot").length, 1);
});

test("source/access failure is BLOCKED immediately", async (t) => {
  const outputDir = await tempDir(t);
  const callLog = [];
  const result = await executeRelease053bFinalProof({
    outputDir,
    authority: authority(),
    invokeTool: syntheticTransport({ firstSearchHttpError: true, callLog }),
  });
  assert.equal(result.classification, "BLOCKED");
  assert.equal(result.summary.failures.source, 1);
  assert.equal(result.summary.call_budget.total_attempts, 1);
  assert.equal(callLog.length, 1);
});

test("strict parser failure is BLOCKED and emits only sanitized schema diagnostic", async (t) => {
  const outputDir = await tempDir(t);
  const world = fixtureWorld();
  const firstId = [...world.instruments.keys()][0];
  const result = await executeRelease053bFinalProof({
    outputDir,
    authority: authority(),
    invokeTool: syntheticTransport({
      world,
      malformedSnapshotId: firstId,
    }),
  });
  assert.equal(result.classification, "BLOCKED");
  assert.equal(result.summary.failures.parser, 1);
  const content = await readFile(join(outputDir, "sanitized-schema-diagnostics.jsonl"), "utf8");
  const records = parseRelease053DiagnosticsJsonl(content);
  assert.equal(records.length, 1);
  assert.equal(records[0].primary_category, "WRONG_JSON_TYPE");
  assert.equal(content.includes("DO-NOT-RETAIN-WRONG-TYPE-VALUE"), false);
  assert.equal(content.includes("price_last"), false);
  assert.match(release053bDiagnosticsHash(records), /^[a-f0-9]{64}$/u);
});

test("impossible future observation fails closed to BLOCKED", () => {
  assert.equal(classifyRelease053bObservation({
    pre_dispatch_valid: true,
    source_failure_count: 0,
    parser_failure_count: 0,
    accounting_failure_count: 0,
    plan_exhausted: false,
    verified_unique_events: 10,
    evaluable_snapshots: 10,
    quality_passes: 9,
    quality_rejects: 0,
    retry_count: 0,
  }), "BLOCKED");
});

test("clean deterministic exhaustion below 30 is INSUFFICIENT", () => {
  assert.equal(classifyRelease053bObservation({
    pre_dispatch_valid: true,
    source_failure_count: 0,
    parser_failure_count: 0,
    accounting_failure_count: 0,
    plan_exhausted: true,
    verified_unique_events: 29,
    evaluable_snapshots: 29,
    quality_passes: 29,
    quality_rejects: 0,
    retry_count: 0,
  }), "INSUFFICIENT");
});

test("release053 integrity manifest binds ledger, summary, and diagnostics hashes", async (t) => {
  const outputDir = await tempDir(t);
  const result = await executeRelease053bFinalProof({
    outputDir,
    authority: authority(),
    invokeTool: syntheticTransport(),
  });
  const manifest = await finalizeRelease053bProofArtifacts(outputDir, {
    classification: result.classification,
  });
  assert.equal(validateRelease053bProofManifest(manifest), manifest);
  assert.match(manifest.ledger_final_hash, /^[a-f0-9]{64}$/u);
  assert.match(manifest.proof_summary_hash, /^[a-f0-9]{64}$/u);
  assert.match(manifest.diagnostics_hash, /^[a-f0-9]{64}$/u);
  assert.match(manifest.artifact_hash, /^[a-f0-9]{64}$/u);
  assert.equal((await readRelease053Diagnostics(outputDir)).length, 0);

  const same = await finalizeRelease053bProofArtifacts(outputDir, {
    classification: result.classification,
  });
  assert.deepEqual(same, manifest);
});

test("post-finalization summary tamper is rejected by integrity checks", async (t) => {
  const outputDir = await tempDir(t);
  const result = await executeRelease053bFinalProof({
    outputDir,
    authority: authority(),
    invokeTool: syntheticTransport(),
  });
  await finalizeRelease053bProofArtifacts(outputDir, { classification: result.classification });
  const summaryPath = join(outputDir, "proof-summary.json");
  const summary = JSON.parse(await readFile(summaryPath, "utf8"));
  summary.discovery.successes = 7;
  await writeFile(summaryPath, JSON.stringify(summary, null, 2) + "\n", "utf8");
  await assert.rejects(
    finalizeRelease053bProofArtifacts(outputDir, { classification: result.classification }),
    /proof_summary_hash mismatch/u,
  );
});

test("post-finalization diagnostics tamper is rejected by release053 integrity manifest", async (t) => {
  const outputDir = await tempDir(t);
  const world = fixtureWorld();
  const firstId = [...world.instruments.keys()][0];
  const result = await executeRelease053bFinalProof({
    outputDir,
    authority: authority(),
    invokeTool: syntheticTransport({ world, malformedSnapshotId: firstId }),
  });
  await finalizeRelease053bProofArtifacts(outputDir, { classification: result.classification });
  const diagnosticsPath = join(outputDir, "sanitized-schema-diagnostics.jsonl");
  const content = await readFile(diagnosticsPath, "utf8");
  await writeFile(diagnosticsPath, content + "\n", "utf8");
  const same = await finalizeRelease053bProofArtifacts(outputDir, { classification: result.classification });
  assert.match(same.diagnostics_hash, /^[a-f0-9]{64}$/u);

  const records = parseRelease053DiagnosticsJsonl(content);
  const modified = structuredClone(records[0]);
  modified.call_sequence += 100;
  modified.diagnostic_hash = "0".repeat(64);
  await writeFile(diagnosticsPath, canonicalSerialize(modified) + "\n", "utf8");
  await assert.rejects(
    finalizeRelease053bProofArtifacts(outputDir, { classification: result.classification }),
    /invalid diagnostics JSONL|diagnostic_hash mismatch/u,
  );
});

test("release053 future workflow is manual-only/read-only and remains release-specific", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/release053-final-source-proof.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /name: Release 0\.5\.3 Final Source Proof/u);
  assert.match(workflow, /workflow_dispatch:/u);
  assert.doesNotMatch(workflow, /^\s+(?:push|pull_request|schedule|workflow_run):/mu);
  assert.match(workflow, /permissions:\n  contents: read/u);
  assert.match(workflow, /timeout-minutes: 20/u);
  assert.match(workflow, /Pre-dispatch authority and freeze validation/u);
  assert.match(workflow, /Always reconcile outstanding reservations/u);
  assert.match(workflow, /sanitized-schema-diagnostics\.jsonl/u);
  assert.match(workflow, /release053-proof-manifest\.json/u);
  assert.doesNotMatch(workflow, /https?:\/\/[^\s]*(?:polymarket|kalshi)/iu);
});

test("0.5.3B runtime and development dependencies remain zero", async () => {
  const packageJson = JSON.parse(await readFile(
    new URL("../package.json", import.meta.url),
    "utf8",
  ));
  assert.deepEqual(packageJson.dependencies ?? {}, {});
  assert.deepEqual(packageJson.devDependencies ?? {}, {});
});
