import { rm } from "node:fs/promises";
import {
  DeterministicCryptoStructProofRunner,
  finalizeProofArtifacts,
} from "../src/cryptostruct-proof-runner.mjs";
import { cryptoStructSourceContractHash } from "../src/cryptostruct-source.mjs";

const outputDir = process.env.RELEASE052_ARTIFACT_DIR ?? "release052-artifact";
const runnerCommit = process.env.RELEASE052_RUNNER_COMMIT
  ?? process.env.GITHUB_SHA
  ?? "release052-synthetic-offline";
const proofRunId = process.env.RELEASE052_PROOF_RUN_ID ?? "release052-synthetic-ci";

function envelope(payload, id) {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text: JSON.stringify(payload) }],
    },
  });
}

function syntheticInvoke({ tool, args, callSequence }) {
  if (tool === "search_instruments") {
    return {
      httpStatus: 200,
      bodyText: envelope({
        total_matching: 1,
        showing: 1,
        hits: [{
          instrument_id: 1001001,
          code: "synthetic-weather-yes",
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
        }],
      }, callSequence),
    };
  }
  if (tool === "get_instrument") {
    return {
      httpStatus: 200,
      bodyText: envelope({
        instrument_id: Number(args.instrument_id),
        code: "synthetic-weather-yes",
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
      }, callSequence),
    };
  }
  return {
    httpStatus: 200,
    bodyText: envelope({
      instrument_id: Number(args.instrument_id),
      code: "synthetic-weather-yes",
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
    }, callSequence),
  };
}

await rm(outputDir, { recursive: true, force: true });

let classification = "QUALIFIED";
let exitCode = 0;
try {
  const runner = await DeterministicCryptoStructProofRunner.create({
    outputDir,
    proof_run_id: proofRunId,
    source_contract_hash: cryptoStructSourceContractHash(),
    runner_commit: runnerCommit,
    runner_version: "0.5.2",
    max_attempted_calls: 3,
    max_unique_candidates: 1,
    per_call_timeout_ms: 5_000,
    whole_proof_timeout_ms: 30_000,
    discovery_plan: [
      { q: "synthetic-weather", class: "prediction", venue: "polymarket", limit: 1 },
    ],
    selector_config: {
      order: [
        "turnover_usd_60m_desc",
        "trades_60m_desc",
        "spread_bps_60m_avg_asc",
        "top1_depth_min_side_usd_60m_desc",
        "instrument_id_lexicographic",
      ],
    },
    invokeTool: syntheticInvoke,
  });

  const discovery = await runner.executeCall("search_instruments", {
    q: "synthetic-weather",
    class: "prediction",
    venue: "polymarket",
    limit: 1,
  });
  if (discovery.terminal_status !== "SUCCESS") throw new Error("synthetic discovery failed");

  const instrumentId = discovery.parsed.instruments[0].instrument_id;
  const master = await runner.executeCall(
    "get_instrument",
    { instrument_id: Number(instrumentId) },
    { instrumentId },
  );
  if (master.terminal_status !== "SUCCESS") throw new Error("synthetic get_instrument failed");

  const snapshot = await runner.executeCall(
    "get_market_snapshot",
    { instrument_id: Number(instrumentId) },
    { instrumentId },
  );
  if (snapshot.terminal_status !== "SUCCESS") throw new Error("synthetic get_market_snapshot failed");
} catch (error) {
  classification = "BLOCKED";
  exitCode = 1;
  console.error(error instanceof Error ? error.message : String(error));
} finally {
  const manifest = await finalizeProofArtifacts(outputDir, { classification });
  console.log(JSON.stringify({
    proof_run_id: manifest.proof_run_id,
    classification: manifest.classification,
    total_reserved_attempts: manifest.total_reserved_attempts,
    unique_candidate_count: manifest.unique_candidate_count,
    artifact_hash: manifest.artifact_hash,
  }));
}

process.exitCode = exitCode;
