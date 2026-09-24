import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalSerialize, sha256Hex } from "../src/canonical.mjs";
import {
  DeterministicCryptoStructProofRunner,
  finalizeProofArtifacts,
} from "../src/cryptostruct-proof-runner.mjs";
import {
  PHASE0B_ALLOWED_CATEGORIES,
  cryptoStructSourceContractHash,
} from "../src/cryptostruct-source.mjs";
import {
  RELEASE052_SEMANTIC_BUNDLE_SCHEMA,
  RELEASE052_SEMANTIC_MATCHER_VERSION,
  RELEASE052_STAGE2,
  RELEASE052_STAGE2_DISCOVERY_PLAN,
  RELEASE052_STAGE2_SELECTOR_CONFIG,
  executeRelease052LiveProof,
  mapRelease052IndependentSemanticBundle,
  normalizeRelease052SemanticKey,
  readRelease052ProofSummary,
  release052IndependentSemanticBundleHash,
  release052Stage2Hashes,
  selectRelease052DeepProbeCandidates,
  validateRelease052LiveAuthority,
  validateRelease052ProofSummary,
} from "../src/release052-live-proof.mjs";

const COMMIT = "a".repeat(40);
const PROOF_RUN_ID = "release-0.5.2-stage2-cryptostruct-20260924-test";
const START = "2026-09-24T04:00:00.000Z";

function spec({
  eventId = "event-alpha",
  question = "Event Alpha",
  category = "WEATHER_CLIMATE",
  criteriaHash = "c".repeat(64),
} = {}) {
  return {
    schema_version: "independent-event-spec.v1",
    event_id: eventId,
    canonical_question: question,
    yes_condition: question + " resolves YES",
    no_condition: question + " resolves NO",
    category,
    deadline_utc: "2026-10-01T00:00:00.000Z",
    resolution_authority: "Independent public authority",
    resolution_reference: "independent-reference-" + eventId,
    criteria_hash: criteriaHash,
    allowed_cutoffs: ["T-24h", "T-6h", "T-1h"],
  };
}

function semanticBundle(events = [
  {
    spec: spec(),
    semantic_aliases: ["Event Alpha"],
  },
]) {
  return {
    schema_version: RELEASE052_SEMANTIC_BUNDLE_SCHEMA,
    matcher_version: RELEASE052_SEMANTIC_MATCHER_VERSION,
    events,
  };
}

function authority(overrides = {}) {
  const hashes = release052Stage2Hashes();
  const bundle = overrides.independent_semantic_bundle ?? semanticBundle();
  return {
    actual_runner_commit: COMMIT,
    authorized_runner_commit: COMMIT,
    proof_run_id: PROOF_RUN_ID,
    authorized_proof_run_id: PROOF_RUN_ID,
    expected_source_contract_hash: hashes.source_contract_hash,
    expected_discovery_plan_hash: hashes.discovery_plan_hash,
    expected_selector_config_hash: hashes.selector_config_hash,
    expected_max_attempted_calls: String(RELEASE052_STAGE2.max_attempted_calls),
    expected_max_unique_candidates: String(RELEASE052_STAGE2.max_unique_candidates),
    expected_per_call_timeout_ms: String(RELEASE052_STAGE2.per_call_timeout_ms),
    expected_whole_proof_timeout_ms: String(RELEASE052_STAGE2.whole_proof_timeout_ms),
    independent_semantic_bundle: bundle,
    expected_independent_semantic_bundle_hash:
      overrides.expected_independent_semantic_bundle_hash
      ?? release052IndependentSemanticBundleHash(bundle),
    ...overrides,
  };
}

function instrument(id, overrides = {}) {
  return {
    instrument_id: String(id),
    code: "event-alpha",
    instrument_class: "prediction",
    venue: "polymarket",
    state: "open",
    ...overrides,
  };
}

function discoveryResult(ids, overrides = {}) {
  return {
    terminal_status: "SUCCESS",
    parsed: { instruments: ids.map((id) => instrument(id)) },
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

function searchPayload(items) {
  return {
    total_matching: items.totalMatching ?? items.hits.length,
    showing: items.hits.length,
    hits: items.hits.map((item) => ({
      instrument_id: Number(item.id),
      code: item.code,
      type: item.type ?? "prediction",
      venue: item.venue ?? "polymarket",
      venue_name: "Polymarket",
      base: "POLYMARKET_BET",
      quote: "pUSD",
      state: item.state ?? "open",
      days_with_data: 10,
      first_day: "2026-09-01",
      last_day: "2026-09-23",
      total_bytes_compressed: 1000,
    })),
  };
}

function instrumentPayload(id, {
  code = "event-alpha",
  state = "open",
  type = "prediction",
  venue = "polymarket",
} = {}) {
  return {
    instrument_id: Number(id),
    code,
    type,
    venue,
    venue_name: "Polymarket",
    base: "POLYMARKET_BET",
    quote: "pUSD",
    state,
    days_with_data: 10,
    first_day: "2026-09-01",
    last_day: "2026-09-23",
    total_bytes_compressed: 1000,
    listed_since: "2026-09-01",
  };
}

function snapshotPayload(id, {
  code = "event-alpha",
  trades = 12,
  turnover = 250,
  spread = 250,
  bid = 100,
  ask = 120,
  price = 0.61,
} = {}) {
  return {
    instrument_id: Number(id),
    code,
    venue: "polymarket",
    as_of: "2026-09-24T04:00:00.000Z",
    price_last: price,
    change_24h_pct: null,
    vwap_last_minute: null,
    last_60m: {
      turnover_usd: turnover,
      turnover_buy_usd: null,
      turnover_sell_usd: null,
      trades,
      liquidations: null,
      spread_bps_avg: spread,
      top1_depth_usd: { bid, ask },
      top20_depth_usd: null,
    },
    last_24h: null,
  };
}

async function tempDir(t) {
  const directory = await mkdtemp(join(tmpdir(), "release052-live-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function syntheticTransport({
  discovery = {},
  instruments = {},
  snapshots = {},
  callLog = [],
} = {}) {
  return async ({ tool, args, callSequence }) => {
    callLog.push({ tool, args: structuredClone(args) });
    if (tool === "search_instruments") {
      const item = discovery[args.q] ?? { totalMatching: 0, hits: [] };
      if (item.httpStatus) return { httpStatus: item.httpStatus, bodyText: item.bodyText ?? "failure" };
      return { httpStatus: 200, bodyText: envelope(searchPayload(item), callSequence) };
    }
    if (tool === "get_instrument") {
      const item = instruments[String(args.instrument_id)]
        ?? { id: args.instrument_id, code: "event-alpha" };
      return {
        httpStatus: 200,
        bodyText: envelope(instrumentPayload(args.instrument_id, item), callSequence),
      };
    }
    const item = snapshots[String(args.instrument_id)]
      ?? { id: args.instrument_id, code: "event-alpha" };
    return {
      httpStatus: 200,
      bodyText: envelope(snapshotPayload(args.instrument_id, item), callSequence),
    };
  };
}

test("Stage 2 plan keeps accepted discovery, selector, and budget constants frozen", () => {
  assert.deepEqual(RELEASE052_STAGE2, {
    max_attempted_calls: 45,
    max_unique_candidates: 50,
    per_call_timeout_ms: 10_000,
    whole_proof_timeout_ms: 480_000,
    max_deep_probe_candidates: 20,
  });
  assert.deepEqual(RELEASE052_STAGE2_DISCOVERY_PLAN.map((item) => item.q), [
    "weather",
    "inflation",
    "space",
    "AI",
    "movie",
  ]);
  for (const item of RELEASE052_STAGE2_DISCOVERY_PLAN) {
    assert.deepEqual(
      { class: item.class, venue: item.venue, limit: item.limit },
      { class: "prediction", venue: "polymarket", limit: 10 },
    );
  }
  assert.equal(RELEASE052_STAGE2_SELECTOR_CONFIG.retry, false);
  assert.equal(RELEASE052_STAGE2_SELECTOR_CONFIG.replacement_candidate_on_failure, false);
});

test("selector preserves accepted filter, first occurrence, order, and max 20 behavior", () => {
  const first = discoveryResult([3, 2, 2, 1]);
  first.parsed.instruments.push(instrument(99, { venue: "other" }));
  first.parsed.instruments.push(instrument(98, { instrument_class: "spot" }));
  first.parsed.instruments.push(instrument(97, { state: "closed" }));
  const many = discoveryResult(Array.from({ length: 30 }, (_, index) => 100 + index));
  const selected = selectRelease052DeepProbeCandidates([first, many]);
  assert.deepEqual(selected.slice(0, 3).map((item) => item.instrument_id), ["3", "2", "1"]);
  assert.equal(selected.length, 20);
  assert.equal(new Set(selected.map((item) => item.instrument_id)).size, 20);
});

test("S1: missing independent semantic bundle blocks before runner creation", async (t) => {
  const outputDir = await tempDir(t);
  let calls = 0;
  await assert.rejects(executeRelease052LiveProof({
    outputDir,
    authority: authority({
      independent_semantic_bundle: null,
      expected_independent_semantic_bundle_hash: "0".repeat(64),
    }),
    invokeTool: async () => {
      calls += 1;
      throw new Error("must not dispatch");
    },
  }));
  assert.equal(calls, 0);
  await assert.rejects(readFile(join(outputDir, "sanitized-call-ledger.jsonl"), "utf8"));
  await assert.rejects(readFile(join(outputDir, "proof-summary.json"), "utf8"));
});

test("S1: bundle hash mismatch blocks before CALL_RESERVED", async (t) => {
  const outputDir = await tempDir(t);
  let calls = 0;
  await assert.rejects(executeRelease052LiveProof({
    outputDir,
    authority: authority({ expected_independent_semantic_bundle_hash: "0".repeat(64) }),
    invokeTool: async () => {
      calls += 1;
      throw new Error("must not dispatch");
    },
  }), /independent_semantic_bundle_hash mismatch/u);
  assert.equal(calls, 0);
  await assert.rejects(readFile(join(outputDir, "sanitized-call-ledger.jsonl"), "utf8"));
});

test("S1: invalid IndependentEventSpec blocks before CALL_RESERVED", async (t) => {
  const outputDir = await tempDir(t);
  const invalid = semanticBundle([{
    spec: spec({ category: "NOT_ALLOWED" }),
    semantic_aliases: ["Event Alpha"],
  }]);
  let calls = 0;
  await assert.rejects(executeRelease052LiveProof({
    outputDir,
    authority: {
      ...authority(),
      independent_semantic_bundle: invalid,
      expected_independent_semantic_bundle_hash: "0".repeat(64),
    },
    invokeTool: async () => {
      calls += 1;
      throw new Error("must not dispatch");
    },
  }), /category not allowed/u);
  assert.equal(calls, 0);
  await assert.rejects(readFile(join(outputDir, "sanitized-call-ledger.jsonl"), "utf8"));
});

test("S1: other frozen authority mismatches also remain pre-dispatch fail-closed", () => {
  const mismatches = [
    { actual_runner_commit: "b".repeat(40) },
    { expected_source_contract_hash: "0".repeat(64) },
    { expected_discovery_plan_hash: "1".repeat(64) },
    { expected_selector_config_hash: "2".repeat(64) },
    { proof_run_id: "arbitrary-manual-value" },
    { expected_max_attempted_calls: "44" },
    { expected_max_unique_candidates: "49" },
    { expected_per_call_timeout_ms: "9999" },
    { expected_whole_proof_timeout_ms: "479999" },
  ];
  for (const patch of mismatches) {
    assert.throws(() => validateRelease052LiveAuthority(authority(patch)));
  }
});

test("S1: zero semantic matches remains semantic_mapping_unproven", () => {
  const result = mapRelease052IndependentSemanticBundle({
    bundle: semanticBundle(),
    instrument: instrument(1, { code: "different-event" }),
    mappingTimestamp: START,
  });
  assert.equal(result.status, "semantic_mapping_unproven");
  assert.equal(result.match_count, 0);
  assert.equal(result.category, null);
});

test("S1: multiple exact semantic matches remain semantic_mapping_unproven", () => {
  const bundle = semanticBundle([
    {
      spec: spec({ eventId: "a", question: "Event A", category: "WEATHER_CLIMATE" }),
      semantic_aliases: ["Shared Alias"],
    },
    {
      spec: spec({ eventId: "b", question: "Event B", category: "MACROECONOMICS", criteriaHash: "d".repeat(64) }),
      semantic_aliases: ["Shared Alias"],
    },
  ]);
  const result = mapRelease052IndependentSemanticBundle({
    bundle,
    instrument: instrument(1, { code: "shared-alias" }),
    mappingTimestamp: START,
  });
  assert.equal(result.status, "semantic_mapping_unproven");
  assert.equal(result.match_count, 2);
});

test("S1: exactly one normalized alias match creates and validates VERIFIED mapping", () => {
  const result = mapRelease052IndependentSemanticBundle({
    bundle: semanticBundle(),
    instrument: instrument(1, { code: "EVENT---ALPHA" }),
    mappingTimestamp: START,
  });
  assert.equal(result.status, "VERIFIED");
  assert.equal(result.match_count, 1);
  assert.equal(result.category, "WEATHER_CLIMATE");
  assert.match(result.independent_event_spec_hash, /^[a-f0-9]{64}$/u);
  assert.match(result.source_mapping_record_hash, /^[a-f0-9]{64}$/u);
  assert.match(result.mapping_evidence_hash, /^[a-f0-9]{64}$/u);
});

test("S1: mapping algorithm never reads probability and category comes only from IndependentEventSpec", () => {
  const liveInstrument = instrument(1, {
    code: "event-alpha",
    category: "ENTERTAINMENT_CULTURE",
  });
  Object.defineProperty(liveInstrument, "p_control", {
    get() {
      throw new Error("probability must not be read by semantic mapping");
    },
  });
  const result = mapRelease052IndependentSemanticBundle({
    bundle: semanticBundle(),
    instrument: liveInstrument,
    mappingTimestamp: START,
  });
  assert.equal(result.status, "VERIFIED");
  assert.equal(result.category, "WEATHER_CLIMATE");
  assert.equal(normalizeRelease052SemanticKey("Event-&-Alpha"), "event and alpha");
});

test("accepted discovery order and no-retry behavior remain unchanged", async (t) => {
  const outputDir = await tempDir(t);
  const calls = [];
  const result = await executeRelease052LiveProof({
    outputDir,
    authority: authority(),
    invokeTool: syntheticTransport({
      callLog: calls,
      discovery: {
        weather: { totalMatching: 2, hits: [{ id: 101, code: "event-alpha" }] },
        inflation: { httpStatus: 503 },
      },
      instruments: {
        "101": { code: "event-alpha" },
      },
      snapshots: {
        "101": { code: "event-alpha" },
      },
    }),
  });
  assert.deepEqual(
    calls.filter((call) => call.tool === "search_instruments").map((call) => call.args.q),
    ["weather", "inflation", "space", "AI", "movie"],
  );
  assert.equal(calls.filter((call) => call.tool === "search_instruments").length, 5);
  assert.equal(result.classification, "BLOCKED");
});

test("S2: completed INSUFFICIENT proof writes aggregate proof-summary.json", async (t) => {
  const outputDir = await tempDir(t);
  const result = await executeRelease052LiveProof({
    outputDir,
    authority: authority(),
    invokeTool: syntheticTransport({
      discovery: {
        weather: { totalMatching: 17, hits: [{ id: 201, code: "different-event" }] },
      },
      instruments: {
        "201": { code: "different-event" },
      },
      snapshots: {
        "201": { code: "different-event" },
      },
    }),
  });
  assert.equal(result.classification, "INSUFFICIENT");
  const summary = await readRelease052ProofSummary(outputDir);
  assert.equal(summary.classification, "INSUFFICIENT");
  assert.equal(summary.discovery.total_matching_by_query.weather, 17);
  assert.equal(summary.discovery.unique_discovered_candidate_count, 1);
  assert.equal(summary.selection.selected_deep_probe_count, 1);
  assert.equal(summary.semantic.verified_count, 0);
  assert.equal(summary.semantic.semantic_mapping_unproven_count, 1);
  assert.equal(summary.quality.pass_count, 1);
  assert.equal(summary.joint_eligibility.mapped_quality_pass, 0);
  assert.equal(validateRelease052ProofSummary(summary), summary);
});

test("S2: proof summary is non-reconstructive and excludes market identifiers, codes, questions, probabilities, and raw payloads", async (t) => {
  const outputDir = await tempDir(t);
  const markerQuestion = "HIGHLY UNIQUE PRIVATE-IN-PROOF QUESTION";
  const bundle = semanticBundle([{
    spec: spec({ question: markerQuestion }),
    semantic_aliases: ["Event Alpha"],
  }]);
  await executeRelease052LiveProof({
    outputDir,
    authority: authority({ independent_semantic_bundle: bundle }),
    invokeTool: syntheticTransport({
      discovery: {
        weather: { totalMatching: 9, hits: [{ id: 987654321, code: "event-alpha" }] },
      },
      instruments: {
        "987654321": { code: "event-alpha" },
      },
      snapshots: {
        "987654321": { code: "event-alpha", price: 0.7312345 },
      },
    }),
  });
  const text = await readFile(join(outputDir, "proof-summary.json"), "utf8");
  for (const forbidden of [
    "987654321",
    "event-alpha",
    markerQuestion,
    "0.7312345",
    "p_control",
    "raw_response",
    "raw_orderbook",
  ]) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
});

test("S2: proof_summary_hash is integrity-bound into final manifest and artifact hash", async (t) => {
  const outputDir = await tempDir(t);
  const result = await executeRelease052LiveProof({
    outputDir,
    authority: authority(),
    invokeTool: syntheticTransport({
      discovery: {
        weather: { totalMatching: 1, hits: [{ id: 301, code: "event-alpha" }] },
      },
    }),
  });
  assert.equal(result.classification, "QUALIFIED");
  const summary = await readRelease052ProofSummary(outputDir);
  const expectedSummaryHash = sha256Hex(canonicalSerialize(summary));
  const manifest = await finalizeProofArtifacts(outputDir, {
    classification: result.classification,
    endedAt: "2026-09-24T04:10:00.000Z",
  });
  assert.equal(manifest.proof_summary_hash, expectedSummaryHash);
  assert.match(manifest.artifact_hash, /^[a-f0-9]{64}$/u);

  const firstArtifactHash = manifest.artifact_hash;
  const second = await finalizeProofArtifacts(outputDir, {
    classification: "BLOCKED",
    endedAt: "2026-09-24T05:00:00.000Z",
  });
  assert.deepEqual(second, manifest);
  assert.equal(second.artifact_hash, firstArtifactHash);
});

test("S2: BLOCKED proof writes deterministic aggregate summary when runner initialized", async (t) => {
  const outputDir = await tempDir(t);
  const result = await executeRelease052LiveProof({
    outputDir,
    authority: authority(),
    invokeTool: syntheticTransport({
      discovery: {
        weather: { httpStatus: 503 },
      },
    }),
  });
  assert.equal(result.classification, "BLOCKED");
  const summary = await readRelease052ProofSummary(outputDir);
  assert.equal(summary.classification, "BLOCKED");
  assert.equal(summary.discovery.attempts, 5);
  assert.equal(summary.discovery.successes, 4);
  assert.equal(summary.discovery.total_matching_by_query.weather, null);
  assert.equal(summary.joint_eligibility.mapped_quality_pass, 0);
});

test("S2: synthetic proof-control finalization stays compatible with explicit absent-summary contract", async (t) => {
  const outputDir = await tempDir(t);
  const runner = await DeterministicCryptoStructProofRunner.create({
    outputDir,
    proof_run_id: "release052-synthetic-summary-compat",
    source_contract_hash: cryptoStructSourceContractHash(),
    runner_commit: "synthetic-commit",
    runner_version: "0.5.2",
    max_attempted_calls: 3,
    max_unique_candidates: 1,
    per_call_timeout_ms: 5_000,
    whole_proof_timeout_ms: 30_000,
    discovery_plan: [{ q: "synthetic", class: "prediction", venue: "polymarket", limit: 1 }],
    selector_config: { synthetic: true },
    invokeTool: async ({ callSequence }) => ({
      httpStatus: 200,
      bodyText: envelope(searchPayload({
        totalMatching: 1,
        hits: [{ id: 401, code: "synthetic" }],
      }), callSequence),
    }),
  });
  await runner.executeCall("search_instruments", {
    q: "synthetic",
    class: "prediction",
    venue: "polymarket",
    limit: 1,
  });
  runner.close();
  const manifest = await finalizeProofArtifacts(outputDir, {
    classification: "QUALIFIED",
    endedAt: "2026-09-24T04:01:00.000Z",
  });
  assert.equal(manifest.proof_summary_hash, null);
  await assert.rejects(readFile(join(outputDir, "proof-summary.json"), "utf8"));
});

test("S2: quality rejection reasons, category coverage, schema fingerprints, and throughput inputs are durable aggregates", async (t) => {
  const outputDir = await tempDir(t);
  const bundle = semanticBundle([
    {
      spec: spec({ eventId: "alpha", question: "Event Alpha", category: "WEATHER_CLIMATE" }),
      semantic_aliases: ["Event Alpha"],
    },
    {
      spec: spec({
        eventId: "beta",
        question: "Event Beta",
        category: "SCIENCE_TECHNOLOGY",
        criteriaHash: "d".repeat(64),
      }),
      semantic_aliases: ["Event Beta"],
    },
  ]);
  const result = await executeRelease052LiveProof({
    outputDir,
    authority: authority({ independent_semantic_bundle: bundle }),
    invokeTool: syntheticTransport({
      discovery: {
        weather: {
          totalMatching: 41,
          hits: [
            { id: 501, code: "event-alpha" },
            { id: 502, code: "event-beta" },
          ],
        },
        inflation: { totalMatching: 13, hits: [] },
      },
      instruments: {
        "501": { code: "event-alpha" },
        "502": { code: "event-beta" },
      },
      snapshots: {
        "501": { code: "event-alpha" },
        "502": {
          code: "event-beta",
          trades: 1,
          turnover: 50,
          spread: 2501,
          bid: 20,
          ask: 30,
        },
      },
    }),
  });
  assert.equal(result.classification, "QUALIFIED");
  const summary = await readRelease052ProofSummary(outputDir);
  assert.equal(summary.discovery.total_matching_by_query.weather, 41);
  assert.equal(summary.discovery.total_matching_by_query.inflation, 13);
  assert.equal(summary.quality.pass_count, 1);
  assert.equal(summary.quality.reject_count, 1);
  assert.deepEqual(summary.quality.rejection_reason_counts, {
    low_trades_60m: 1,
    low_turnover_60m: 1,
    invalid_or_wide_spread: 1,
    low_top1_depth: 1,
  });
  assert.equal(summary.joint_eligibility.mapped_quality_pass, 1);
  assert.equal(summary.joint_eligibility.mapped_quality_reject, 1);
  assert.equal(summary.joint_eligibility.mapped_quality_pass_rate, 0.5);
  assert.equal(summary.category.mapped_quality_pass_counts.WEATHER_CLIMATE, 1);
  assert.equal(summary.category.mapped_quality_pass_counts.SCIENCE_TECHNOLOGY, 0);
  assert.equal(summary.throughput_review_inputs.discovery_total_matching_sum, 54);
  assert.equal(summary.throughput_review_inputs.unique_discovered_count, 2);
  assert.equal(summary.throughput_review_inputs.selected_count, 2);
  assert.equal(summary.throughput_review_inputs.jointly_mapped_quality_pass_count, 1);
  assert.equal(summary.throughput_review_inputs.allowed_category_coverage_count, 1);
  for (const tool of ["search_instruments", "get_instrument", "get_market_snapshot"]) {
    assert.equal(Object.keys(summary.schema_fingerprints[tool]).length > 0, true);
  }
});

test("S3: mapped quality-fail A plus unmapped quality-pass B does not qualify", async (t) => {
  const outputDir = await tempDir(t);
  const result = await executeRelease052LiveProof({
    outputDir,
    authority: authority(),
    invokeTool: syntheticTransport({
      discovery: {
        weather: {
          totalMatching: 2,
          hits: [
            { id: 601, code: "event-alpha" },
            { id: 602, code: "event-unmapped" },
          ],
        },
      },
      instruments: {
        "601": { code: "event-alpha" },
        "602": { code: "event-unmapped" },
      },
      snapshots: {
        "601": { code: "event-alpha", trades: 1 },
        "602": { code: "event-unmapped" },
      },
    }),
  });
  const summary = await readRelease052ProofSummary(outputDir);
  assert.equal(summary.semantic.verified_count, 1);
  assert.equal(summary.semantic.semantic_mapping_unproven_count, 1);
  assert.equal(summary.quality.pass_count, 1);
  assert.equal(summary.quality.reject_count, 1);
  assert.equal(summary.joint_eligibility.mapped_quality_pass, 0);
  assert.equal(summary.joint_eligibility.mapped_quality_reject, 1);
  assert.equal(result.classification, "INSUFFICIENT");
  assert.equal(
    Object.values(summary.category.mapped_quality_pass_counts).reduce((a, b) => a + b, 0),
    0,
  );
});

test("S3: one same candidate VERIFIED plus quality PASS increments joint eligibility and can qualify", async (t) => {
  const outputDir = await tempDir(t);
  const result = await executeRelease052LiveProof({
    outputDir,
    authority: authority(),
    invokeTool: syntheticTransport({
      discovery: {
        weather: { totalMatching: 1, hits: [{ id: 701, code: "event-alpha" }] },
      },
      instruments: {
        "701": { code: "event-alpha" },
      },
      snapshots: {
        "701": { code: "event-alpha" },
      },
    }),
  });
  const summary = await readRelease052ProofSummary(outputDir);
  assert.equal(summary.joint_eligibility.mapped_quality_pass, 1);
  assert.equal(summary.joint_eligibility.mapped_quality_reject, 0);
  assert.equal(summary.joint_eligibility.mapped_quality_pass_rate, 1);
  assert.equal(summary.category.mapped_quality_pass_counts.WEATHER_CLIMATE, 1);
  assert.equal(result.classification, "QUALIFIED");
});

test("joint category counts include only mapped plus quality-pass candidates", async (t) => {
  const outputDir = await tempDir(t);
  const bundle = semanticBundle([
    {
      spec: spec({ eventId: "alpha", question: "Event Alpha", category: "WEATHER_CLIMATE" }),
      semantic_aliases: ["Event Alpha"],
    },
    {
      spec: spec({
        eventId: "beta",
        question: "Event Beta",
        category: "MACROECONOMICS",
        criteriaHash: "d".repeat(64),
      }),
      semantic_aliases: ["Event Beta"],
    },
  ]);
  await executeRelease052LiveProof({
    outputDir,
    authority: authority({ independent_semantic_bundle: bundle }),
    invokeTool: syntheticTransport({
      discovery: {
        weather: {
          totalMatching: 3,
          hits: [
            { id: 801, code: "event-alpha" },
            { id: 802, code: "event-beta" },
            { id: 803, code: "unmapped" },
          ],
        },
      },
      instruments: {
        "801": { code: "event-alpha" },
        "802": { code: "event-beta" },
        "803": { code: "unmapped" },
      },
      snapshots: {
        "801": { code: "event-alpha" },
        "802": { code: "event-beta", turnover: 10 },
        "803": { code: "unmapped" },
      },
    }),
  });
  const summary = await readRelease052ProofSummary(outputDir);
  assert.deepEqual(summary.category.mapped_quality_pass_counts, {
    WEATHER_CLIMATE: 1,
    MACROECONOMICS: 0,
    SCIENCE_TECHNOLOGY: 0,
    ENTERTAINMENT_CULTURE: 0,
  });
  assert.equal(
    Object.keys(summary.category.mapped_quality_pass_counts).sort().join(","),
    [...PHASE0B_ALLOWED_CATEGORIES].sort().join(","),
  );
});

test("live workflow remains manual-only/read-only/15-minute and now freezes semantic bundle plus uploads summary", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/release052-live-proof.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /workflow_dispatch:/u);
  assert.doesNotMatch(workflow, /^\s+(?:push|pull_request|schedule|workflow_run):/mu);
  assert.match(workflow, /permissions:\n  contents: read/u);
  assert.match(workflow, /timeout-minutes: 15/u);
  assert.match(workflow, /independent_semantic_bundle_json:/u);
  assert.match(workflow, /independent_semantic_bundle_hash:/u);
  assert.match(workflow, /Pre-dispatch authority and config validation/u);
  assert.match(workflow, /Execute deterministic live proof[\s\S]*continue-on-error: true/u);
  assert.match(workflow, /Always reconcile outstanding reservations/u);
  assert.match(workflow, /Always finalize sanitized artifact/u);
  assert.match(workflow, /proof-summary\.json/u);
  assert.match(workflow, /Always upload sanitized proof artifact/u);
  assert.match(workflow, /Propagate execution failure after preservation/u);
  assert.equal(
    workflow.indexOf("Always upload sanitized proof artifact")
      < workflow.indexOf("Propagate execution failure after preservation"),
    true,
  );
  assert.doesNotMatch(workflow, /https?:\/\/[^\s]*polymarket/u);
  assert.doesNotMatch(workflow, /https?:\/\/[^\s]*kalshi/u);
  assert.doesNotMatch(workflow, /playwright|puppeteer|selenium/u);
  assert.doesNotMatch(workflow, /openai|anthropic|gemini/u);
});
