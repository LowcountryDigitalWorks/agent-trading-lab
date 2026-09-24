import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DeterministicCryptoStructProofRunner,
  DurableProofCallLedger,
  ProofBudgetError,
  buildFrozenProofConfig,
  computeProofCallRecordHash,
  finalizeProofArtifacts,
  parseProofCallLedgerJsonl,
  readProofArtifacts,
  validateProofCallLedger,
  validateProofManifest,
} from "../src/cryptostruct-proof-runner.mjs";
import { cryptoStructSourceContractHash } from "../src/cryptostruct-source.mjs";

const START = "2026-09-24T04:00:00.000Z";

function deterministicTime(start = START) {
  let epoch = Date.parse(start);
  return {
    clock: () => {
      const value = new Date(epoch).toISOString();
      epoch += 1;
      return value;
    },
    nowMs: () => epoch,
  };
}

function mcpEnvelope(payload, id = 1) {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      content: [
        {
          type: "text",
          text: JSON.stringify(payload),
        },
      ],
    },
  };
}

function okResponse(payload, { id = 1 } = {}) {
  return {
    httpStatus: 200,
    bodyText: JSON.stringify(mcpEnvelope(payload, id)),
  };
}

function searchPayload(ids) {
  return {
    total_matching: ids.length,
    showing: ids.length,
    hits: ids.map((id, index) => ({
      instrument_id: Number(id),
      code: `synthetic-${id}`,
      type: "prediction",
      venue: "polymarket",
      venue_name: "Polymarket",
      base: "POLYMARKET_BET",
      quote: "pUSD",
      state: "open",
      days_with_data: 10 + index,
      first_day: "2026-09-01",
      last_day: "2026-09-23",
      total_bytes_compressed: 1000 + index,
    })),
  };
}

function instrumentPayload(id) {
  return {
    instrument_id: Number(id),
    code: `synthetic-${id}`,
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
  };
}

function snapshotPayload(id) {
  return {
    instrument_id: Number(id),
    code: `synthetic-${id}`,
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

async function tempOutput(t) {
  const directory = await mkdtemp(join(tmpdir(), "ldw-release052-"));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

async function makeRunner(
  t,
  {
    invokeTool = async ({ tool, args }) => {
      if (tool === "search_instruments") return okResponse(searchPayload([1001]), { id: 1 });
      if (tool === "get_instrument") return okResponse(instrumentPayload(args.instrument_id), { id: 2 });
      return okResponse(snapshotPayload(args.instrument_id), { id: 3 });
    },
    maxAttemptedCalls = 10,
    maxUniqueCandidates = 10,
    perCallTimeoutMs = 1000,
    wholeProofTimeoutMs = 10_000,
    discoveryPlan = [{ q: "weather", class: "prediction", venue: "polymarket", limit: 1 }],
    selectorConfig = { order: ["turnover", "trades", "spread", "depth", "id"] },
    time = deterministicTime(),
  } = {},
) {
  const outputDir = await tempOutput(t);
  const runner = await DeterministicCryptoStructProofRunner.create({
    outputDir,
    proof_run_id: "release052-test-run",
    source_contract_hash: cryptoStructSourceContractHash(),
    runner_commit: "synthetic-test-commit",
    runner_version: "0.5.2",
    max_attempted_calls: maxAttemptedCalls,
    max_unique_candidates: maxUniqueCandidates,
    per_call_timeout_ms: perCallTimeoutMs,
    whole_proof_timeout_ms: wholeProofTimeoutMs,
    discovery_plan: discoveryPlan,
    selector_config: selectorConfig,
    invokeTool,
    clock: time.clock,
    nowMs: time.nowMs,
  });
  return { runner, outputDir, time };
}

test("SUCCESS reserves and dispatches before network invocation", async (t) => {
  let observedRecords = null;
  let outputDir;
  const invokeTool = async () => {
    const ledgerText = await readFile(join(outputDir, "sanitized-call-ledger.jsonl"), "utf8");
    observedRecords = parseProofCallLedgerJsonl(ledgerText);
    return okResponse(searchPayload([1001]));
  };
  const built = await makeRunner(t, { invokeTool });
  outputDir = built.outputDir;
  const result = await built.runner.executeCall("search_instruments", {
    q: "weather",
    class: "prediction",
    venue: "polymarket",
    limit: 1,
  });
  assert.equal(result.terminal_status, "SUCCESS");
  assert.equal(observedRecords.length, 2);
  assert.equal(observedRecords[0].record_type, "CALL_RESERVED");
  assert.equal(observedRecords[1].record_type, "CALL_DISPATCHED");
  assert.equal(observedRecords[0].call_sequence, 1);
});

test("SUCCESS records one exact attempted call and candidate count", async (t) => {
  const { runner } = await makeRunner(t);
  await runner.executeCall("search_instruments", {
    q: "weather",
    class: "prediction",
    venue: "polymarket",
    limit: 1,
  });
  const state = runner.ledgerState();
  assert.equal(state.total_reserved_attempts, 1);
  assert.equal(state.terminal_status_counts.SUCCESS, 1);
  assert.equal(state.unique_candidate_count, 1);
});

test("HTTP_ERROR is terminal and still consumes the attempted-call budget", async (t) => {
  const { runner } = await makeRunner(t, {
    invokeTool: async () => ({ httpStatus: 503, bodyText: "temporarily unavailable" }),
  });
  const result = await runner.executeCall("search_instruments", {
    q: "weather",
    class: "prediction",
    venue: "polymarket",
    limit: 1,
  });
  assert.equal(result.terminal_status, "HTTP_ERROR");
  assert.equal(runner.ledgerState().total_reserved_attempts, 1);
  assert.equal(runner.ledgerState().terminal_status_counts.HTTP_ERROR, 1);
});

test("MCP_ERROR is terminal and never reuses the sequence", async (t) => {
  const { runner } = await makeRunner(t, {
    invokeTool: async () => ({
      httpStatus: 200,
      bodyText: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32000, message: "synthetic MCP failure" },
      }),
    }),
  });
  const result = await runner.executeCall("search_instruments", {
    q: "weather",
    class: "prediction",
    venue: "polymarket",
    limit: 1,
  });
  assert.equal(result.terminal_status, "MCP_ERROR");
  assert.equal(runner.ledgerState().call_states.get(1).terminal.terminal_status, "MCP_ERROR");
});

test("per-call timeout becomes TIMEOUT and consumes the reservation", async (t) => {
  const time = deterministicTime();
  const { runner } = await makeRunner(t, {
    invokeTool: async () => new Promise(() => {}),
    perCallTimeoutMs: 5,
    wholeProofTimeoutMs: 1000,
    time,
  });
  const result = await runner.executeCall("search_instruments", {
    q: "weather",
    class: "prediction",
    venue: "polymarket",
    limit: 1,
  });
  assert.equal(result.terminal_status, "TIMEOUT");
  assert.equal(result.terminal.terminal_reason_code, "per_call_timeout");
  assert.equal(runner.ledgerState().total_reserved_attempts, 1);
});

test("proof-wide timeout preempts the per-call timeout", async (t) => {
  const start = Date.parse(START);
  let nowCalls = 0;
  const time = {
    clock: deterministicTime().clock,
    nowMs: () => {
      nowCalls += 1;
      return nowCalls === 1 ? start : start + 200;
    },
  };
  const { runner } = await makeRunner(t, {
    invokeTool: async () => new Promise(() => {}),
    perCallTimeoutMs: 100,
    wholeProofTimeoutMs: 150,
    time,
  });
  const result = await runner.executeCall("search_instruments", {
    q: "weather",
    class: "prediction",
    venue: "polymarket",
    limit: 1,
  });
  assert.equal(result.terminal_status, "TIMEOUT");
  assert.equal(result.terminal.terminal_reason_code, "whole_proof_timeout");
});

test("malformed JSON becomes PARSE_ERROR", async (t) => {
  const { runner } = await makeRunner(t, {
    invokeTool: async () => ({ httpStatus: 200, bodyText: "{not-json" }),
  });
  const result = await runner.executeCall("search_instruments", {
    q: "weather",
    class: "prediction",
    venue: "polymarket",
    limit: 1,
  });
  assert.equal(result.terminal_status, "PARSE_ERROR");
  assert.equal(result.terminal.terminal_reason_code, "invalid_json_response");
});

test("source-contract parse failure becomes PARSE_ERROR", async (t) => {
  const { runner } = await makeRunner(t, {
    invokeTool: async () => okResponse({ undocumented: true }),
  });
  const result = await runner.executeCall("search_instruments", {
    q: "weather",
    class: "prediction",
    venue: "polymarket",
    limit: 1,
  });
  assert.equal(result.terminal_status, "PARSE_ERROR");
  assert.equal(result.terminal.terminal_reason_code, "source_contract_parse_error");
});

test("reservation without response reconciles to RUNNER_ABORTED_AFTER_RESERVATION", async (t) => {
  const { runner, outputDir } = await makeRunner(t);
  await runner.reserveCall("search_instruments", {
    q: "weather",
    class: "prediction",
    venue: "polymarket",
    limit: 1,
  });
  const manifest = await finalizeProofArtifacts(outputDir, {
    classification: "BLOCKED",
    endedAt: "2026-09-24T04:01:00.000Z",
  });
  assert.equal(manifest.total_reserved_attempts, 1);
  assert.equal(manifest.terminal_status_counts.RUNNER_ABORTED_AFTER_RESERVATION, 1);
  const artifacts = await readProofArtifacts(outputDir);
  assert.equal(
    artifacts.validation.call_states.get(1).terminal.terminal_reason_code,
    "runner_aborted_before_dispatch",
  );
});

test("dispatched interruption reconciles without redispatch", async (t) => {
  let invoked = 0;
  const { runner, outputDir } = await makeRunner(t, {
    invokeTool: async () => {
      invoked += 1;
      return okResponse(searchPayload([1001]));
    },
  });
  const reservation = await runner.reserveCall("search_instruments", {
    q: "weather",
    class: "prediction",
    venue: "polymarket",
    limit: 1,
  });
  await runner.ledger.markDispatched(reservation, {
    dispatch_timestamp: "2026-09-24T04:00:00.050Z",
  });
  await finalizeProofArtifacts(outputDir, {
    classification: "BLOCKED",
    endedAt: "2026-09-24T04:01:00.000Z",
  });
  assert.equal(invoked, 0);
  const artifacts = await readProofArtifacts(outputDir);
  assert.equal(
    artifacts.validation.call_states.get(1).terminal.terminal_reason_code,
    "runner_aborted_after_dispatch",
  );
});

test("attempted-call budget exhaustion prevents dispatch", async (t) => {
  let dispatches = 0;
  const { runner } = await makeRunner(t, {
    maxAttemptedCalls: 1,
    invokeTool: async () => {
      dispatches += 1;
      return okResponse(searchPayload([1001]));
    },
  });
  await runner.executeCall("search_instruments", {
    q: "weather",
    class: "prediction",
    venue: "polymarket",
    limit: 1,
  });
  await assert.rejects(
    () => runner.executeCall("search_instruments", {
      q: "movie",
      class: "prediction",
      venue: "polymarket",
      limit: 1,
    }),
    (error) => error instanceof ProofBudgetError && error.code === "ATTEMPT_BUDGET_EXHAUSTED",
  );
  assert.equal(dispatches, 1);
  assert.equal(runner.ledgerState().total_reserved_attempts, 1);
});

test("duplicate candidate IDs do not consume additional unique-candidate capacity", async (t) => {
  let invocation = 0;
  const { runner } = await makeRunner(t, {
    maxUniqueCandidates: 3,
    invokeTool: async ({ callSequence }) => {
      invocation += 1;
      return invocation === 1
        ? okResponse(searchPayload([1001, 1002]), { id: callSequence })
        : okResponse(searchPayload([1001]), { id: callSequence });
    },
  });
  await runner.executeCall("search_instruments", {
    q: "weather",
    class: "prediction",
    venue: "polymarket",
    limit: 2,
  });
  await runner.executeCall("search_instruments", {
    q: "climate",
    class: "prediction",
    venue: "polymarket",
    limit: 1,
  });
  assert.equal(runner.ledgerState().unique_candidate_count, 2);
  assert.equal(runner.remainingCandidateCapacity(), 1);
});

test("unique-candidate ceiling prevents another search reservation and dispatch", async (t) => {
  let dispatches = 0;
  const { runner } = await makeRunner(t, {
    maxUniqueCandidates: 2,
    invokeTool: async () => {
      dispatches += 1;
      return okResponse(searchPayload([1001, 1002]));
    },
  });
  await runner.executeCall("search_instruments", {
    q: "weather",
    class: "prediction",
    venue: "polymarket",
    limit: 2,
  });
  await assert.rejects(
    () => runner.executeCall("search_instruments", {
      q: "movie",
      class: "prediction",
      venue: "polymarket",
      limit: 1,
    }),
    (error) => error instanceof ProofBudgetError && error.code === "UNIQUE_CANDIDATE_BUDGET_EXCEEDED",
  );
  assert.equal(dispatches, 1);
  assert.equal(runner.ledgerState().unique_candidate_count, 2);
});

test("follow-on source calls require an already-discovered candidate", async (t) => {
  let dispatches = 0;
  const { runner } = await makeRunner(t, {
    invokeTool: async () => {
      dispatches += 1;
      return okResponse(instrumentPayload(9999));
    },
  });
  await assert.rejects(
    () => runner.executeCall(
      "get_instrument",
      { instrument_id: 9999 },
      { instrumentId: 9999 },
    ),
    (error) => error instanceof ProofBudgetError && error.code === "UNDISCOVERED_CANDIDATE",
  );
  assert.equal(dispatches, 0);
  assert.equal(runner.ledgerState().total_reserved_attempts, 0);
});

test("search response exceeding requested limit fails closed without registering candidates", async (t) => {
  const { runner } = await makeRunner(t, {
    invokeTool: async () => okResponse(searchPayload([1001, 1002])),
  });
  const result = await runner.executeCall("search_instruments", {
    q: "weather",
    class: "prediction",
    venue: "polymarket",
    limit: 1,
  });
  assert.equal(result.terminal_status, "PARSE_ERROR");
  assert.equal(runner.ledgerState().unique_candidate_count, 0);
});

test("hash-chain integrity detects tampering", async (t) => {
  const { runner } = await makeRunner(t);
  await runner.executeCall("search_instruments", {
    q: "weather",
    class: "prediction",
    venue: "polymarket",
    limit: 1,
  });
  const records = structuredClone(runner.ledger.records);
  records[1].dispatch_timestamp = "2026-09-24T05:00:00.000Z";
  assert.throws(() => validateProofCallLedger(records), /record_hash mismatch/u);
});

test("record hash deterministically covers all persisted material except record_hash", async (t) => {
  const { runner } = await makeRunner(t);
  const reservation = await runner.reserveCall("search_instruments", {
    q: "weather",
    class: "prediction",
    venue: "polymarket",
    limit: 1,
  });
  assert.equal(reservation.record_hash, computeProofCallRecordHash(reservation));
});

test("duplicate terminal state is rejected before it can corrupt durable ledger", async (t) => {
  const { runner } = await makeRunner(t);
  const reservation = await runner.reserveCall("search_instruments", {
    q: "weather",
    class: "prediction",
    venue: "polymarket",
    limit: 1,
  });
  await runner.ledger.terminal(reservation, {
    terminal_status: "RUNNER_ABORTED_AFTER_RESERVATION",
    terminal_reason_code: "synthetic_abort",
  });
  await assert.rejects(
    () => runner.ledger.terminal(reservation, {
      terminal_status: "RUNNER_ABORTED_AFTER_RESERVATION",
      terminal_reason_code: "second_terminal",
    }),
    /more than one terminal state/u,
  );
  assert.equal(runner.ledger.records.length, 2);
});

test("call_sequence is monotonic and never reused", async (t) => {
  const { runner } = await makeRunner(t);
  const first = await runner.reserveCall("search_instruments", {
    q: "weather",
    class: "prediction",
    venue: "polymarket",
    limit: 1,
  });
  await runner.ledger.terminal(first, {
    terminal_status: "RUNNER_ABORTED_AFTER_RESERVATION",
    terminal_reason_code: "synthetic_abort",
  });
  const second = await runner.reserveCall("search_instruments", {
    q: "movie",
    class: "prediction",
    venue: "polymarket",
    limit: 1,
  });
  assert.equal(first.call_sequence, 1);
  assert.equal(second.call_sequence, 2);
});

test("concurrent executeCall operations are single-flight with monotonic sequences", async (t) => {
  let activeTransports = 0;
  let maxActiveTransports = 0;
  const { runner } = await makeRunner(t, {
    maxAttemptedCalls: 2,
    maxUniqueCandidates: 2,
    invokeTool: async ({ callSequence }) => {
      activeTransports += 1;
      maxActiveTransports = Math.max(maxActiveTransports, activeTransports);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeTransports -= 1;
      return okResponse(searchPayload([1000 + callSequence]), { id: callSequence });
    },
  });

  const results = await Promise.all([
    runner.executeCall("search_instruments", {
      q: "weather",
      class: "prediction",
      venue: "polymarket",
      limit: 1,
    }),
    runner.executeCall("search_instruments", {
      q: "movie",
      class: "prediction",
      venue: "polymarket",
      limit: 1,
    }),
  ]);

  assert.deepEqual(results.map((result) => result.terminal_status), ["SUCCESS", "SUCCESS"]);
  assert.equal(maxActiveTransports, 1);

  const state = runner.ledgerState();
  assert.equal(state.total_reserved_attempts, 2);
  assert.equal(state.unique_candidate_count, 2);
  assert.deepEqual(
    [...state.call_states.keys()],
    [1, 2],
  );
  assert.equal(
    validateProofCallLedger(runner.ledger.records, { requireTerminalForEveryReservation: true }).valid,
    true,
  );
});

test("concurrent callers with one attempted-call slot reserve and dispatch exactly once", async (t) => {
  let dispatches = 0;
  const { runner } = await makeRunner(t, {
    maxAttemptedCalls: 1,
    maxUniqueCandidates: 2,
    invokeTool: async ({ callSequence }) => {
      dispatches += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return okResponse(searchPayload([1001]), { id: callSequence });
    },
  });

  const settled = await Promise.allSettled([
    runner.executeCall("search_instruments", {
      q: "weather",
      class: "prediction",
      venue: "polymarket",
      limit: 1,
    }),
    runner.executeCall("search_instruments", {
      q: "movie",
      class: "prediction",
      venue: "polymarket",
      limit: 1,
    }),
  ]);

  assert.equal(dispatches, 1);
  assert.equal(settled.filter((item) => item.status === "fulfilled").length, 1);
  const rejected = settled.find((item) => item.status === "rejected");
  assert.equal(rejected.reason instanceof ProofBudgetError, true);
  assert.equal(rejected.reason.code, "ATTEMPT_BUDGET_EXHAUSTED");

  const records = runner.ledger.records;
  assert.equal(records.filter((record) => record.record_type === "CALL_RESERVED").length, 1);
  assert.equal(records.filter((record) => record.record_type === "CALL_DISPATCHED").length, 1);
  assert.equal(records.filter((record) => record.record_type === "CALL_TERMINAL").length, 1);
  assert.equal(runner.ledgerState().total_reserved_attempts, 1);
});

test("concurrent searches cannot exceed unique-candidate capacity", async (t) => {
  let dispatches = 0;
  const { runner } = await makeRunner(t, {
    maxAttemptedCalls: 3,
    maxUniqueCandidates: 1,
    invokeTool: async ({ callSequence }) => {
      dispatches += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return okResponse(searchPayload([1001]), { id: callSequence });
    },
  });

  const settled = await Promise.allSettled([
    runner.executeCall("search_instruments", {
      q: "weather",
      class: "prediction",
      venue: "polymarket",
      limit: 1,
    }),
    runner.executeCall("search_instruments", {
      q: "movie",
      class: "prediction",
      venue: "polymarket",
      limit: 1,
    }),
  ]);

  assert.equal(dispatches, 1);
  assert.equal(settled[0].status, "fulfilled");
  assert.equal(settled[1].status, "rejected");
  assert.equal(settled[1].reason.code, "UNIQUE_CANDIDATE_BUDGET_EXCEEDED");

  const state = runner.ledgerState();
  assert.equal(state.total_reserved_attempts, 1);
  assert.equal(state.unique_candidate_count, 1);
  assert.deepEqual([...state.call_states.keys()], [1]);
  assert.equal(
    validateProofCallLedger(runner.ledger.records, { requireTerminalForEveryReservation: true }).valid,
    true,
  );
});

test("matching numeric JSON-RPC response ID remains successful", async (t) => {
  const { runner } = await makeRunner(t, {
    invokeTool: async ({ callSequence }) => okResponse(searchPayload([1001]), { id: callSequence }),
  });
  const result = await runner.executeCall("search_instruments", {
    q: "weather",
    class: "prediction",
    venue: "polymarket",
    limit: 1,
  });
  assert.equal(result.terminal_status, "SUCCESS");
  assert.equal(runner.ledgerState().unique_candidate_count, 1);
});

test("mismatched numeric JSON-RPC response ID fails closed without source evidence", async (t) => {
  const { runner } = await makeRunner(t, {
    invokeTool: async ({ callSequence }) => okResponse(searchPayload([1001]), { id: callSequence + 1 }),
  });
  const result = await runner.executeCall("search_instruments", {
    q: "weather",
    class: "prediction",
    venue: "polymarket",
    limit: 1,
  });
  assert.equal(result.terminal_status, "PARSE_ERROR");
  assert.equal(result.terminal.terminal_reason_code, "jsonrpc_protocol_mismatch");
  assert.equal(result.terminal.source_schema_fingerprint, null);
  assert.deepEqual(result.terminal.candidate_hashes, []);
  assert.equal(runner.ledgerState().unique_candidate_count, 0);
});

test("string JSON-RPC response ID does not match numeric reservation ID", async (t) => {
  const { runner } = await makeRunner(t, {
    invokeTool: async ({ callSequence }) => ({
      httpStatus: 200,
      bodyText: JSON.stringify(mcpEnvelope(searchPayload([1001]), String(callSequence))),
    }),
  });
  const result = await runner.executeCall("search_instruments", {
    q: "weather",
    class: "prediction",
    venue: "polymarket",
    limit: 1,
  });
  assert.equal(result.terminal_status, "PARSE_ERROR");
  assert.equal(result.terminal.terminal_reason_code, "jsonrpc_protocol_mismatch");
  assert.equal(runner.ledgerState().unique_candidate_count, 0);
});

test("missing or invalid JSON-RPC version fails protocol correlation", async (t) => {
  for (const jsonrpc of [undefined, "1.0"]) {
    const { runner } = await makeRunner(t, {
      invokeTool: async ({ callSequence }) => {
        const envelope = mcpEnvelope(searchPayload([1001]), callSequence);
        if (jsonrpc === undefined) delete envelope.jsonrpc;
        else envelope.jsonrpc = jsonrpc;
        return { httpStatus: 200, bodyText: JSON.stringify(envelope) };
      },
    });
    const result = await runner.executeCall("search_instruments", {
      q: "weather",
      class: "prediction",
      venue: "polymarket",
      limit: 1,
    });
    assert.equal(result.terminal_status, "PARSE_ERROR");
    assert.equal(result.terminal.terminal_reason_code, "jsonrpc_protocol_mismatch");
  }
});

test("JSON-RPC error envelope with matching ID is MCP_ERROR", async (t) => {
  const { runner } = await makeRunner(t, {
    invokeTool: async ({ callSequence }) => ({
      httpStatus: 200,
      bodyText: JSON.stringify({
        jsonrpc: "2.0",
        id: callSequence,
        error: { code: -32000, message: "synthetic MCP failure" },
      }),
    }),
  });
  const result = await runner.executeCall("search_instruments", {
    q: "weather",
    class: "prediction",
    venue: "polymarket",
    limit: 1,
  });
  assert.equal(result.terminal_status, "MCP_ERROR");
});

test("JSON-RPC error envelope with wrong ID is PARSE_ERROR not MCP_ERROR", async (t) => {
  const { runner } = await makeRunner(t, {
    invokeTool: async ({ callSequence }) => ({
      httpStatus: 200,
      bodyText: JSON.stringify({
        jsonrpc: "2.0",
        id: callSequence + 1,
        error: { code: -32000, message: "synthetic MCP failure" },
      }),
    }),
  });
  const result = await runner.executeCall("search_instruments", {
    q: "weather",
    class: "prediction",
    venue: "polymarket",
    limit: 1,
  });
  assert.equal(result.terminal_status, "PARSE_ERROR");
  assert.equal(result.terminal.terminal_reason_code, "jsonrpc_protocol_mismatch");
  assert.equal(result.terminal.source_schema_fingerprint, null);
  assert.deepEqual(result.terminal.candidate_hashes, []);
});

test("mixed success/failure produces an exact attempted-call count", async (t) => {
  let mode = 0;
  const { runner } = await makeRunner(t, {
    invokeTool: async () => {
      mode += 1;
      if (mode === 1) return okResponse(searchPayload([1001]));
      if (mode === 2) return { httpStatus: 500, bodyText: "error" };
      return { httpStatus: 200, bodyText: "{broken" };
    },
  });
  await runner.executeCall("search_instruments", {
    q: "weather",
    class: "prediction",
    venue: "polymarket",
    limit: 1,
  });
  await runner.executeCall("get_instrument", { instrument_id: 1001 }, { instrumentId: 1001 });
  await runner.executeCall("get_market_snapshot", { instrument_id: 1001 }, { instrumentId: 1001 });
  const state = runner.ledgerState();
  assert.equal(state.total_reserved_attempts, 3);
  assert.equal(state.terminal_status_counts.SUCCESS, 1);
  assert.equal(state.terminal_status_counts.HTTP_ERROR, 1);
  assert.equal(state.terminal_status_counts.PARSE_ERROR, 1);
});

test("frozen discovery/selector config hashes are deterministic across run IDs", () => {
  const plan = [{ q: "weather", class: "prediction", venue: "polymarket", limit: 10 }];
  const selector = { order: ["turnover", "trades", "spread", "depth", "id"] };
  const common = {
    source_contract_hash: cryptoStructSourceContractHash(),
    runner_commit: "commit",
    runner_version: "0.5.2",
    max_attempted_calls: 50,
    max_unique_candidates: 50,
    per_call_timeout_ms: 10_000,
    whole_proof_timeout_ms: 120_000,
    discovery_plan: plan,
    selector_config: selector,
  };
  const one = buildFrozenProofConfig({ ...common, proof_run_id: "run-one" }, { startedAt: START });
  const two = buildFrozenProofConfig({ ...common, proof_run_id: "run-two" }, { startedAt: START });
  assert.equal(one.discovery_plan_hash, two.discovery_plan_hash);
  assert.equal(one.selector_config_hash, two.selector_config_hash);
  assert.notEqual(one.config_hash, two.config_hash);
});

test("finalization after runner failure always reconciles and writes a valid manifest", async (t) => {
  const { runner, outputDir } = await makeRunner(t);
  await runner.reserveCall("search_instruments", {
    q: "weather",
    class: "prediction",
    venue: "polymarket",
    limit: 1,
  });
  const manifest = await finalizeProofArtifacts(outputDir, {
    classification: "BLOCKED",
    endedAt: "2026-09-24T04:02:00.000Z",
  });
  assert.equal(validateProofManifest(manifest), manifest);
  assert.equal(manifest.classification, "BLOCKED");
  assert.equal(manifest.terminal_status_counts.RUNNER_ABORTED_AFTER_RESERVATION, 1);
  assert.match(manifest.artifact_hash, /^[a-f0-9]{64}$/u);
  assert.equal(
    (await readFile(join(outputDir, "artifact-hash.txt"), "utf8")).trim(),
    manifest.artifact_hash,
  );
});

test("finalizer also handles an empty ledger and preserves zero attempted calls", async (t) => {
  const { outputDir } = await makeRunner(t);
  const manifest = await finalizeProofArtifacts(outputDir, {
    classification: "BLOCKED",
    endedAt: "2026-09-24T04:02:00.000Z",
  });
  assert.equal(manifest.total_reserved_attempts, 0);
  assert.equal(manifest.unique_candidate_count, 0);
  assert.equal(manifest.ledger_final_hash, null);
});

test("finalization is idempotent and does not append a second recovery terminal", async (t) => {
  const { runner, outputDir } = await makeRunner(t);
  await runner.reserveCall("search_instruments", {
    q: "weather",
    class: "prediction",
    venue: "polymarket",
    limit: 1,
  });
  const first = await finalizeProofArtifacts(outputDir, {
    classification: "BLOCKED",
    endedAt: "2026-09-24T04:02:00.000Z",
  });
  const second = await finalizeProofArtifacts(outputDir, {
    classification: "QUALIFIED",
    endedAt: "2026-09-24T05:00:00.000Z",
  });
  assert.deepEqual(second, first);
  const artifacts = await readProofArtifacts(outputDir);
  assert.equal(artifacts.validation.terminal_status_counts.RUNNER_ABORTED_AFTER_RESERVATION, 1);
});

test("sanitized artifacts never persist raw provider response bodies", async (t) => {
  const rawMarker = "RAW_PROVIDER_BODY_MUST_NOT_SURVIVE";
  const { runner, outputDir } = await makeRunner(t, {
    invokeTool: async () => ({
      httpStatus: 500,
      bodyText: rawMarker,
    }),
  });
  await runner.executeCall("search_instruments", {
    q: "weather",
    class: "prediction",
    venue: "polymarket",
    limit: 1,
  });
  await finalizeProofArtifacts(outputDir, {
    classification: "BLOCKED",
    endedAt: "2026-09-24T04:02:00.000Z",
  });
  const ledger = await readFile(join(outputDir, "sanitized-call-ledger.jsonl"), "utf8");
  const manifest = await readFile(join(outputDir, "proof-manifest.json"), "utf8");
  assert.equal(ledger.includes(rawMarker), false);
  assert.equal(manifest.includes(rawMarker), false);
});

test("manifest terminal counts match finalized ledger exactly", async (t) => {
  let invocation = 0;
  const { runner, outputDir } = await makeRunner(t, {
    invokeTool: async () => {
      invocation += 1;
      return invocation === 1
        ? okResponse(searchPayload([1001]))
        : { httpStatus: 429, bodyText: "rate limited" };
    },
  });
  await runner.executeCall("search_instruments", {
    q: "weather",
    class: "prediction",
    venue: "polymarket",
    limit: 1,
  });
  await runner.executeCall("get_instrument", { instrument_id: 1001 }, { instrumentId: 1001 });
  const manifest = await finalizeProofArtifacts(outputDir, {
    classification: "BLOCKED",
    endedAt: "2026-09-24T04:02:00.000Z",
  });
  assert.equal(manifest.total_reserved_attempts, 2);
  assert.equal(manifest.terminal_status_counts.SUCCESS, 1);
  assert.equal(manifest.terminal_status_counts.HTTP_ERROR, 1);
  assert.equal(manifest.unique_candidate_count, 1);
});

test("unsupported diagnostic tool is rejected before reservation or dispatch", async (t) => {
  let dispatches = 0;
  const { runner } = await makeRunner(t, {
    invokeTool: async () => {
      dispatches += 1;
      return okResponse({});
    },
  });
  await assert.rejects(
    () => runner.executeCall("get_daily_stats", { instrument_id: 1001 }, { instrumentId: 1001 }),
    /tool not allowed by frozen proof contract/u,
  );
  assert.equal(dispatches, 0);
  assert.equal(runner.ledgerState().total_reserved_attempts, 0);
});

test("runner recovery keeps persisted attempted count instead of resetting it", async (t) => {
  const { runner, outputDir } = await makeRunner(t);
  await runner.executeCall("search_instruments", {
    q: "weather",
    class: "prediction",
    venue: "polymarket",
    limit: 1,
  });
  const time = deterministicTime("2026-09-24T04:00:01.000Z");
  const resumed = await DeterministicCryptoStructProofRunner.resume({
    outputDir,
    invokeTool: async ({ callSequence }) => okResponse(instrumentPayload(1001), { id: callSequence }),
    clock: time.clock,
    nowMs: time.nowMs,
  });
  assert.equal(resumed.ledgerState().total_reserved_attempts, 1);
  const result = await resumed.executeCall(
    "get_instrument",
    { instrument_id: 1001 },
    { instrumentId: 1001 },
  );
  assert.equal(result.terminal_status, "SUCCESS");
  assert.equal(resumed.ledgerState().total_reserved_attempts, 2);
});

test("durable ledger prospective validation prevents malformed state from being persisted", async (t) => {
  const outputDir = await tempOutput(t);
  const ledgerPath = join(outputDir, "ledger.jsonl");
  const time = deterministicTime();
  const ledger = await DurableProofCallLedger.createNew(ledgerPath, "proof-run", { clock: time.clock });
  const reservation = await ledger.reserve({
    call_sequence: 1,
    tool: "search_instruments",
    sanitized_argument_hash: "a".repeat(64),
    instrument_id: null,
  });
  await ledger.terminal(reservation, {
    terminal_status: "RUNNER_ABORTED_AFTER_RESERVATION",
    terminal_reason_code: "synthetic_abort",
  });
  const before = await readFile(ledgerPath, "utf8");
  await assert.rejects(
    () => ledger.markDispatched(reservation),
    /dispatched after terminal state/u,
  );
  const after = await readFile(ledgerPath, "utf8");
  assert.equal(after, before);
});
