import test from "node:test";
import assert from "node:assert/strict";
import { canonicalSerialize, sha256Hex } from "../src/canonical.mjs";
import {
  RELEASE03_END_MS,
  RELEASE03_START_MS,
  TIMEFRAME_MS,
  parseFreqtradeOhlcvJson,
} from "../src/freqtrade-artifacts.mjs";
import { ENTRY_STAKE_FRACTION } from "../src/phase0a.mjs";
import {
  RELEASE03_CONTROL_STAKE,
  RELEASE03_SENSITIVITY_STAKE,
  buildRelease03SignalStream,
  runRelease03ExecutabilitySensitivity,
} from "../src/release03.mjs";

function closeAt(hour) {
  if (hour < 60) return 120 - hour * 0.6;
  if (hour < 120) return 84 + (hour - 60) * 1.0;
  return 144 - (hour - 120) * 1.2;
}

function syntheticDatasets() {
  const datasets = {};
  const hours = 190;
  for (const pair of ["BTC/USDT", "ETH/USDT"]) {
    const multiplier = pair.startsWith("BTC") ? 1 : 0.6;
    const candles1h = [];
    for (let hour = 0; hour < hours; hour += 1) {
      const timestamp = RELEASE03_START_MS + hour * TIMEFRAME_MS["1h"];
      const close = closeAt(hour) * multiplier;
      candles1h.push({
        timestamp_ms: timestamp,
        open: close,
        high: close + multiplier,
        low: close - multiplier,
        close,
        base_volume: 100,
      });
    }

    const candles5m = [];
    for (let index = 0; index < hours * 12 + 24; index += 1) {
      const timestamp = RELEASE03_START_MS + index * TIMEFRAME_MS["5m"];
      const hour = Math.min(hours - 1, Math.floor(index / 12));
      const price = closeAt(hour) * multiplier;
      candles5m.push({
        timestamp_ms: timestamp,
        open: price,
        high: price + multiplier,
        low: price - multiplier,
        close: price,
        base_volume: 100,
      });
    }

    const quoteVolume5m = new Map(candles5m.map((bar) => [bar.timestamp_ms, 200_000]));
    const rawTrades = sha256Hex(`${pair}:raw-trades`);
    const raw5m = sha256Hex(`${pair}:raw-5m`);
    const raw1h = sha256Hex(`${pair}:raw-1h`);
    datasets[pair] = {
      trades: [],
      candles5m,
      candles1h,
      quoteVolume5m,
      hashes: {
        raw_trades: rawTrades,
        raw_5m: raw5m,
        raw_1h: raw1h,
        normalized_5m: sha256Hex(canonicalSerialize(candles5m)),
        normalized_1h: sha256Hex(canonicalSerialize(candles1h)),
        quote_volume_5m: sha256Hex(canonicalSerialize([...quoteVolume5m])),
      },
    };
  }
  return datasets;
}

test("Release 0.3 preserves 10 percent as canonical Phase 0A default", () => {
  assert.equal(ENTRY_STAKE_FRACTION, 0.10);
  assert.equal(RELEASE03_CONTROL_STAKE, 0.10);
  assert.equal(RELEASE03_SENSITIVITY_STAKE, 0.01);
});

test("Freqtrade artifact parser accepts only the predeclared Release 0.3 window in addition to Release 0.2", () => {
  const rows = [[RELEASE03_START_MS, 100, 101, 99, 100, 1]];
  const parsed = parseFreqtradeOhlcvJson(JSON.stringify(rows), {
    pair: "BTC/USDT",
    timeframe: "5m",
    startMs: RELEASE03_START_MS,
    endMs: RELEASE03_END_MS,
  });
  assert.equal(parsed.candles.length, 1);
  assert.throws(
    () => parseFreqtradeOhlcvJson(JSON.stringify(rows), {
      pair: "BTC/USDT",
      timeframe: "5m",
      startMs: RELEASE03_START_MS + TIMEFRAME_MS["5m"],
      endMs: RELEASE03_END_MS,
    }),
    /unexpected proof window/u,
  );
});

test("shared signal stream is deterministic and stake-independent", () => {
  const datasets = syntheticDatasets();
  const first = buildRelease03SignalStream(datasets);
  const second = buildRelease03SignalStream(datasets);
  assert.equal(first.digest, second.digest);
  assert.ok(first.actionable_signal_opportunities >= 2);
  assert.ok(first.actionable_entry_opportunities >= 1);
  assert.deepEqual(first.source_identity, second.source_identity);
});

test("frozen 1 percent sensitivity exercises scale-conversion and complete lifecycle on synthetic data", () => {
  const proof = runRelease03ExecutabilitySensitivity(syntheticDatasets());

  assert.equal(proof.classification, "FULL PASS");
  assert.ok(proof.scale_conversion.nominal.scale_conversion_entries >= 1);
  assert.ok(proof.scale_conversion.stress.scale_conversion_entries >= 1);

  for (const name of ["sensitivity_1pct_nominal", "sensitivity_1pct_stress"]) {
    const summary = proof.summaries[name];
    assert.ok(summary.accepted_entries >= 1);
    assert.ok(summary.accepted_exits >= 1);
    assert.ok(summary.complete_round_trips >= 1);
    assert.ok(summary.execution_cost_drag > 0);
    assert.equal(summary.evidence_chain_valid, true);
    assert.equal(summary.reproducible_canonical_digest, true);
    assert.equal(summary.transition_coverage.cash, true);
    assert.equal(summary.transition_coverage.position, true);
    assert.equal(summary.transition_coverage.equity, true);
    assert.equal(summary.transition_coverage.exposure, true);
  }

  assert.equal(proof.summaries.control_10pct_nominal.accepted_entries, 0);
  assert.ok(proof.summaries.control_10pct_nominal.rejection_reasons.liquidity_limit >= 1);
});

test("paired diagnostics use the same opportunity and exact execution bucket", () => {
  const proof = runRelease03ExecutabilitySensitivity(syntheticDatasets());
  const conversion = proof.scale_conversion.nominal.entries.find((entry) => entry.scale_conversion_entry);
  assert.ok(conversion);
  assert.equal(conversion.control_10pct_liquidity_result, "liquidity_limit");
  assert.equal(conversion.sensitivity_1pct_liquidity_result, "pass");
  assert.equal(conversion.sensitivity_1pct_entry_result, "accepted");
  assert.ok(conversion.control_10pct_desired_order_notional > conversion.sensitivity_1pct_desired_order_notional);
  assert.ok(conversion.execution_bucket_quote_volume > 0);
});
