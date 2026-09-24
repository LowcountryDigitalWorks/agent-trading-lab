import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { finalizeProofArtifacts } from "../src/cryptostruct-proof-runner.mjs";
import {
  RELEASE052_STAGE2,
  RELEASE052_STAGE2_DISCOVERY_PLAN,
  RELEASE052_STAGE2_SELECTOR_CONFIG,
  executeRelease052LiveProof,
  release052Stage2Hashes,
  selectRelease052DeepProbeCandidates,
  validateRelease052LiveAuthority,
} from "../src/release052-live-proof.mjs";

const COMMIT = "a".repeat(40);
const PROOF_RUN_ID = "release-0.5.2-stage2-cryptostruct-20260924-test";

function authority(overrides = {}) {
  const hashes = release052Stage2Hashes();
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
    ...overrides,
  };
}

function instrument(id, overrides = {}) {
  return {
    instrument_id: String(id),
    code: "synthetic-" + id,
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

function searchPayload(ids) {
  return {
    total_matching: ids.length,
    showing: ids.length,
    hits: ids.map((id) => ({
      instrument_id: Number(id),
      code: "synthetic-" + id,
      type: "prediction",
      venue: "polymarket",
      venue_name: "Polymarket",
      base: "POLYMARKET_BET",
      quote: "pUSD",
      state: "open",
      days_with_data: 10,
      first_day: "2026-09-01",
      last_day: "2026-09-23",
      total_bytes_compressed: 1000,
    })),
  };
}

function instrumentPayload(id, overrides = {}) {
  return {
    instrument_id: Number(id),
    code: "synthetic-" + id,
    type: "prediction",
    venue: "polymarket",
    venue_name: "Polymarket",
    base: "POLYMARKET_BET",
    quote: "pUSD",
    state: "open",
    days_with_data: 10,
    first_day: "2026-09-01",
    last_day: "2026-09-23",
    total_bytes_compressed: 1000,
    listed_since: "2026-09-01",
    ...overrides,
  };
}

function snapshotPayload(id) {
  return {
    instrument_id: Number(id),
    code: "synthetic-" + id,
    venue: "polymarket",
    as_of: "2026-09-24T04:00:00.000Z",
    price_last: 0.61,
    change_24h_pct: null,
    vwap_last_minute: null,
    last_60m: {
      turnover_usd: 250,
      turnover_buy_usd: null,
      turnover_sell_usd: null,
      trades: 12,
      liquidations: null,
      spread_bps_avg: 250,
      top1_depth_usd: { bid: 100, ask: 120 },
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

test("Stage 2 plan freezes exact discovery and budget constants", () => {
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

test("selector filters, preserves first occurrence, stays deterministic, and caps at 20", () => {
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

test("all required authority mismatches fail before reservation or dispatch", async (t) => {
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

  const outputDir = await tempDir(t);
  let calls = 0;
  await assert.rejects(executeRelease052LiveProof({
    outputDir,
    authority: authority({ expected_max_attempted_calls: "44" }),
    invokeTool: async () => {
      calls += 1;
      throw new Error("must never dispatch");
    },
  }));
  assert.equal(calls, 0);
  await assert.rejects(readFile(join(outputDir, "sanitized-call-ledger.jsonl"), "utf8"));
});

test("orchestration has no discovery retry and snapshots only eligible successful instruments", async (t) => {
  const outputDir = await tempDir(t);
  const calls = [];
  let searchCount = 0;
  const invokeTool = async ({ tool, args, callSequence }) => {
    calls.push({ tool, args: structuredClone(args) });
    if (tool === "search_instruments") {
      searchCount += 1;
      if (searchCount === 2) return { httpStatus: 503, bodyText: "unavailable" };
      const ids = searchCount === 1 ? [101, 102] : [];
      return { httpStatus: 200, bodyText: envelope(searchPayload(ids), callSequence) };
    }
    if (tool === "get_instrument") {
      const payload = Number(args.instrument_id) === 102
        ? instrumentPayload(102, { state: "closed" })
        : instrumentPayload(args.instrument_id);
      return { httpStatus: 200, bodyText: envelope(payload, callSequence) };
    }
    return {
      httpStatus: 200,
      bodyText: envelope(snapshotPayload(args.instrument_id), callSequence),
    };
  };

  const result = await executeRelease052LiveProof({
    outputDir,
    authority: authority(),
    invokeTool,
  });

  const searches = calls.filter((call) => call.tool === "search_instruments");
  assert.deepEqual(searches.map((call) => call.args.q), [
    "weather",
    "inflation",
    "space",
    "AI",
    "movie",
  ]);
  assert.equal(searches.length, 5);
  assert.equal(calls.filter((call) => call.tool === "get_instrument").length, 2);
  assert.equal(calls.filter((call) => call.tool === "get_market_snapshot").length, 1);
  assert.equal(
    calls.find((call) => call.tool === "get_market_snapshot").args.instrument_id,
    101,
  );
  assert.equal(result.summary.discovery_attempts, 5);
  assert.equal(result.summary.instrument_ineligible, 1);
  assert.equal(result.classification, "BLOCKED");
  assert.equal(calls.length <= 45, true);

  const discovered = new Set([101, 102]);
  for (const call of calls.filter((item) => item.tool !== "search_instruments")) {
    assert.equal(discovered.has(call.args.instrument_id), true);
  }
});

test("successful synthetic Stage 2 orchestration finalizes sanitized artifact after runner execution", async (t) => {
  const outputDir = await tempDir(t);
  const calls = [];
  const invokeTool = async ({ tool, args, callSequence }) => {
    calls.push(tool);
    if (tool === "search_instruments") {
      const ids = args.q === "weather" ? [201] : [];
      return { httpStatus: 200, bodyText: envelope(searchPayload(ids), callSequence) };
    }
    if (tool === "get_instrument") {
      return {
        httpStatus: 200,
        bodyText: envelope(instrumentPayload(args.instrument_id), callSequence),
      };
    }
    return {
      httpStatus: 200,
      bodyText: envelope(snapshotPayload(args.instrument_id), callSequence),
    };
  };

  const result = await executeRelease052LiveProof({
    outputDir,
    authority: authority(),
    invokeTool,
    semanticMapper: async () => ({ status: "VERIFIED", category: "WEATHER_CLIMATE" }),
  });
  assert.equal(result.classification, "QUALIFIED");
  assert.equal(calls.length, 7);

  const manifest = await finalizeProofArtifacts(outputDir, {
    classification: result.classification,
  });
  assert.equal(manifest.total_reserved_attempts, 7);
  assert.equal(manifest.unique_candidate_count, 1);
  assert.equal(manifest.classification, "QUALIFIED");

  for (const name of [
    "sanitized-call-ledger.jsonl",
    "proof-manifest.json",
    "artifact-hash.txt",
  ]) {
    assert.equal((await readFile(join(outputDir, name), "utf8")).length > 0, true);
  }
  const ledger = await readFile(join(outputDir, "sanitized-call-ledger.jsonl"), "utf8");
  assert.equal(ledger.includes("price_last"), false);
  assert.equal(ledger.includes("last_60m"), false);
  assert.equal(ledger.includes("raw_response"), false);
});

test("live workflow is manual-only, read-only, 15-minute bounded, and preserves before propagation", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/release052-live-proof.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /workflow_dispatch:/u);
  assert.doesNotMatch(workflow, /^\s+(?:push|pull_request|schedule|workflow_run):/mu);
  assert.match(workflow, /permissions:\n  contents: read/u);
  assert.match(workflow, /timeout-minutes: 15/u);
  assert.match(workflow, /Execute deterministic live proof[\s\S]*continue-on-error: true/u);
  assert.match(workflow, /Always reconcile outstanding reservations/u);
  assert.match(workflow, /Always finalize sanitized artifact/u);
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
