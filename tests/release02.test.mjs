import test from "node:test";
import assert from "node:assert/strict";
import { canonicalSerialize, sha256Hex } from "../src/canonical.mjs";
import {
  PROOF_END_MS,
  PROOF_START_MS,
  TIMEFRAME_MS,
  deriveQuoteVolume5m,
  parseFreqtradeOhlcvJson,
  parseFreqtradeTradesJson,
} from "../src/freqtrade-artifacts.mjs";
import {
  NOMINAL_COSTS,
  STRESS_COSTS,
  assertCostModelMonotonic,
  buildSignalRows,
  emaSeries,
  executionTerms,
  evaluateEntryRisk,
  nextExecutionBar,
  runPhase0AProof,
} from "../src/phase0a.mjs";

function candleJson(rows) { return JSON.stringify(rows); }
function tradeJson(rows) { return JSON.stringify(rows); }

function fixtureDatasets({ quoteVolume = 10_000_000 } = {}) {
  const datasets = {};
  for (const pair of ["BTC/USDT", "ETH/USDT"]) {
    const candles1h = [];
    const candles5m = [];
    for (let hour = 0; hour < 80; hour += 1) {
      const ts = PROOF_START_MS + hour * TIMEFRAME_MS["1h"];
      const base = pair.startsWith("BTC") ? 100 : 50;
      const close = hour < 55 ? base - hour * 0.2 : base - 11 + (hour - 55) * 1.5;
      candles1h.push({ timestamp_ms: ts, open: close, high: close + 1, low: close - 1, close, base_volume: 100 });
    }
    for (let index = 0; index < 80 * 12 + 20; index += 1) {
      const ts = PROOF_START_MS + index * TIMEFRAME_MS["5m"];
      const base = pair.startsWith("BTC") ? 100 : 50;
      const price = base + index * 0.001;
      candles5m.push({ timestamp_ms: ts, open: price, high: price + 1, low: price - 1, close: price + 0.2, base_volume: 100 });
    }
    datasets[pair] = {
      candles1h,
      candles5m,
      quoteVolume5m: new Map(candles5m.map((c) => [c.timestamp_ms, quoteVolume])),
      hashes: {
        normalized_1h: sha256Hex(canonicalSerialize(candles1h)),
        normalized_5m: sha256Hex(canonicalSerialize(candles5m)),
      },
    };
  }
  return datasets;
}

test("OHLCV importer validates positional artifact and rejects duplicate timestamps", () => {
  const rows = [
    [PROOF_START_MS, 100, 102, 99, 101, 10],
    [PROOF_START_MS + TIMEFRAME_MS["5m"], 101, 103, 100, 102, 11],
  ];
  const parsed = parseFreqtradeOhlcvJson(candleJson(rows), { pair: "BTC/USDT", timeframe: "5m" });
  assert.equal(parsed.candles.length, 2);
  assert.equal(parsed.diagnostics.gaps.length, 0);
  assert.throws(() => parseFreqtradeOhlcvJson(candleJson([rows[0], rows[0]]), { pair: "BTC/USDT", timeframe: "5m" }), /duplicate candle timestamp/u);
});

test("importers fail closed on malformed data or artifacts with no frozen-window rows", () => {
  assert.throws(() => parseFreqtradeOhlcvJson("{}", { pair: "BTC/USDT", timeframe: "5m" }), /JSON array/u);
  assert.throws(
    () => parseFreqtradeOhlcvJson(candleJson([[PROOF_END_MS, 1, 1, 1, 1, 0]]), { pair: "BTC/USDT", timeframe: "5m" }),
    /no rows in the frozen proof window/u,
  );
  assert.throws(() => parseFreqtradeTradesJson(tradeJson([[PROOF_START_MS, "a", null, "buy", 1, 1]]), { pair: "BTC/USDT" }), /exactly 7/u);
});

test("importers deterministically trim validated Freqtrade boundary over-fetch and report it", () => {
  const candleRows = [
    [PROOF_START_MS - TIMEFRAME_MS["5m"], 99, 100, 98, 99, 1],
    [PROOF_START_MS, 100, 101, 99, 100, 1],
    [PROOF_END_MS, 101, 102, 100, 101, 1],
  ];
  const candles = parseFreqtradeOhlcvJson(candleJson(candleRows), { pair: "BTC/USDT", timeframe: "5m" });
  assert.equal(candles.candles.length, 1);
  assert.equal(candles.candles[0].timestamp_ms, PROOF_START_MS);
  assert.equal(candles.diagnostics.raw_count, 3);
  assert.equal(candles.diagnostics.excluded_before_window, 1);
  assert.equal(candles.diagnostics.excluded_after_window, 1);

  const tradeRows = [
    [PROOF_START_MS - 1, "before", null, "buy", 99, 1, 99],
    [PROOF_START_MS + 1, "inside", null, "buy", 100, 2, 200],
    [PROOF_END_MS, "after", null, "sell", 101, 1, 101],
  ];
  const trades = parseFreqtradeTradesJson(tradeJson(tradeRows), { pair: "BTC/USDT" });
  assert.equal(trades.trades.length, 1);
  assert.equal(trades.trades[0].id, "inside");
  assert.equal(trades.diagnostics.raw_count, 3);
  assert.equal(trades.diagnostics.excluded_before_window, 1);
  assert.equal(trades.diagnostics.excluded_after_window, 1);
});

test("quote volume is derived from price times amount, not supplied cost", () => {
  const parsed = parseFreqtradeTradesJson(tradeJson([
    [PROOF_START_MS + 1, "a", null, "buy", 100, 2, 999999],
    [PROOF_START_MS + 2, "b", null, "sell", 50, 3, 1],
  ]), { pair: "BTC/USDT" });
  const quote = deriveQuoteVolume5m(parsed.trades);
  assert.equal(quote.rows.length, 1);
  assert.equal(quote.rows[0].quote_volume, 350);
  assert.match(quote.provenance.method, /price \* amount/u);
});

test("EMA uses only current and prior closed candles", () => {
  const candles = Array.from({ length: 60 }, (_, i) => ({ close: i + 1 }));
  const before = emaSeries(candles, 20);
  const changedFuture = structuredClone(candles);
  changedFuture[59].close = 1_000_000;
  const after = emaSeries(changedFuture, 20);
  assert.deepEqual(before.slice(0, 59), after.slice(0, 59));
});

test("signal decision occurs at 1h close and future candle changes do not alter prior signal rows", () => {
  const data = fixtureDatasets()["BTC/USDT"].candles1h;
  const rows = buildSignalRows("BTC/USDT", data);
  assert.ok(rows.length > 0);
  assert.equal(rows[0].decision_ms, data[50].timestamp_ms + TIMEFRAME_MS["1h"]);
  const changed = structuredClone(data);
  changed.at(-1).close *= 100;
  const rerun = buildSignalRows("BTC/USDT", changed);
  assert.deepEqual(rows.slice(0, -1), rerun.slice(0, -1));
});

test("execution alignment requires exact nominal and stress 5m buckets", () => {
  const decision = PROOF_START_MS + TIMEFRAME_MS["1h"];
  const completeBars = [0, 5, 10, 65, 70].map((minutes) => ({ timestamp_ms: PROOF_START_MS + minutes * 60_000, open: 100 }));
  assert.equal(nextExecutionBar(completeBars, decision, 0).timestamp_ms, PROOF_START_MS + 65 * 60_000);
  assert.equal(nextExecutionBar(completeBars, decision, 1).timestamp_ms, PROOF_START_MS + 70 * 60_000);

  const missingStressBucket = [65, 75].map((minutes) => ({ timestamp_ms: PROOF_START_MS + minutes * 60_000, open: 100 }));
  assert.equal(nextExecutionBar(missingStressBucket, decision, 0).timestamp_ms, PROOF_START_MS + 65 * 60_000);
  assert.equal(nextExecutionBar(missingStressBucket, decision, 1), null);
  assert.equal(missingStressBucket[1].timestamp_ms, PROOF_START_MS + 75 * 60_000);
});

test("nominal and stress cost terms match frozen bps and are monotonic", () => {
  const nominal = executionTerms("BUY", 100, 1, NOMINAL_COSTS);
  const stress = executionTerms("BUY", 100, 1, STRESS_COSTS);
  assert.equal(nominal.effectivePrice, 100.05);
  assert.ok(Math.abs(nominal.fee - 0.10005) < 1e-12);
  assert.equal(stress.effectivePrice, 100.15);
  assert.ok(Math.abs(stress.fee - 0.10015) < 1e-12);
  assert.equal(assertCostModelMonotonic(), true);
});

test("replay rejects otherwise valid actions when liquidity is insufficient", () => {
  const proof = runPhase0AProof(fixtureDatasets({ quoteVolume: 1 }));
  assert.equal(proof.nominal.metrics.accepted_fill_count, 0);
  assert.ok(proof.nominal.metrics.rejected_action_count > 0);
  assert.ok(proof.nominal.metrics.rejection_reasons.liquidity_limit > 0);
});

test("replay accepts fills with sufficient liquidity and preserves 20 percent exposure ceiling", () => {
  const proof = runPhase0AProof(fixtureDatasets());
  assert.ok(proof.nominal.metrics.accepted_fill_count > 0);
  assert.ok(proof.nominal.metrics.maximum_exposure <= 0.2 + 1e-12);
  assert.equal(proof.cost_model_monotonicity_pass, true);
});

test("replay evidence digest is deterministic for identical normalized inputs", () => {
  const datasets = fixtureDatasets();
  const first = runPhase0AProof(datasets);
  const second = runPhase0AProof(structuredClone(Object.fromEntries(Object.entries(datasets).map(([pair, data]) => [pair, { ...data, quoteVolume5m: new Map(data.quoteVolume5m) }]))));
  assert.equal(first.nominal.evidence_digest, second.nominal.evidence_digest);
  assert.equal(first.stress.evidence_digest, second.stress.evidence_digest);
});


test("risk envelope rejects daily loss, hard drawdown, and aggregate exposure deterministically", () => {
  assert.equal(evaluateEntryRisk({ currentEquity: 9799, dayStartEquity: 10000, peakEquity: 10000, currentExposure: 0, desiredNotional: 900 }), "daily_loss_gate");
  assert.equal(evaluateEntryRisk({ currentEquity: 8999, dayStartEquity: 8999, peakEquity: 10000, currentExposure: 0, desiredNotional: 800 }), "hard_drawdown_gate");
  assert.equal(evaluateEntryRisk({ currentEquity: 10000, dayStartEquity: 10000, peakEquity: 10000, currentExposure: 1500, desiredNotional: 1000 }), "aggregate_exposure_gate");
  assert.equal(evaluateEntryRisk({ currentEquity: 10000, dayStartEquity: 10000, peakEquity: 10000, currentExposure: 1000, desiredNotional: 1000 }), null);
});

test("replay maps missing execution data to rejected SKIP gate", () => {
  const datasets = fixtureDatasets();
  for (const data of Object.values(datasets)) {
    data.candles5m = data.candles5m.filter((bar) => bar.timestamp_ms < PROOF_START_MS + 52 * TIMEFRAME_MS["1h"]);
    data.quoteVolume5m = new Map(data.candles5m.map((bar) => [bar.timestamp_ms, 10_000_000]));
  }
  const proof = runPhase0AProof(datasets);
  assert.ok(proof.nominal.metrics.rejection_reasons.missing_execution_data > 0);
  assert.ok(proof.nominal.evidence.some((record) => record.event_type === "gate" && record.payload.reason_code === "missing_execution_data" && record.payload.action === "SKIP"));
});

test("stress replay fails closed when exact T+10m bucket is missing even if T+15m exists", () => {
  const datasets = fixtureDatasets();
  const pair = "BTC/USDT";
  const signal = buildSignalRows(pair, datasets[pair].candles1h).find((row) => row.transition === "bullish");
  assert.ok(signal);

  const nominalTarget = signal.decision_ms + TIMEFRAME_MS["5m"];
  const stressTarget = signal.decision_ms + 2 * TIMEFRAME_MS["5m"];
  const laterAvailable = signal.decision_ms + 3 * TIMEFRAME_MS["5m"];
  assert.ok(datasets[pair].candles5m.some((bar) => bar.timestamp_ms === nominalTarget));
  assert.ok(datasets[pair].candles5m.some((bar) => bar.timestamp_ms === stressTarget));
  assert.ok(datasets[pair].candles5m.some((bar) => bar.timestamp_ms === laterAvailable));

  datasets[pair].candles5m = datasets[pair].candles5m.filter((bar) => bar.timestamp_ms !== stressTarget);
  datasets[pair].quoteVolume5m.delete(stressTarget);

  const proof = runPhase0AProof(datasets);
  const candidateId = `${pair}@${new Date(signal.decision_ms).toISOString()}`;
  const stressGate = proof.stress.evidence.find(
    (record) => record.event_type === "gate" && record.payload.candidate_id === candidateId,
  );

  assert.ok(stressGate);
  assert.equal(stressGate.payload.reason_code, "missing_execution_data");
  assert.equal(stressGate.payload.action, "SKIP");
  assert.ok(datasets[pair].candles5m.some((bar) => bar.timestamp_ms === laterAvailable));
});
