import { canonicalSerialize, sha256Hex } from "./canonical.mjs";
import {
  RELEASE03_END_MS,
  RELEASE03_END_UTC,
  RELEASE03_START_MS,
  RELEASE03_START_UTC,
  TIMEFRAME_MS,
} from "./freqtrade-artifacts.mjs";
import { validateLedgerRecords } from "./ledger.mjs";
import {
  ENTRY_STAKE_FRACTION,
  NOMINAL_COSTS,
  STRESS_COSTS,
  buildSignalRows,
  nextExecutionBar,
  replayPhase0A,
} from "./phase0a.mjs";

export const RELEASE03_CONTROL_STAKE = ENTRY_STAKE_FRACTION;
export const RELEASE03_SENSITIVITY_STAKE = 0.01;
export const RELEASE03_EXPERIMENT_ID = "phase0a-executability-sensitivity-2026-05-through-08";

function iso(ms) {
  return new Date(ms).toISOString();
}

function signalBucket(dataset, decisionMs, latencyBars) {
  const requiredMs = decisionMs + TIMEFRAME_MS["5m"] * (latencyBars + 1);
  const bar = nextExecutionBar(dataset.candles5m, decisionMs, latencyBars);
  return {
    required_execution_time_utc: iso(requiredMs),
    available: Boolean(bar),
    source_bucket: bar
      ? {
          timestamp_utc: iso(bar.timestamp_ms),
          open: bar.open,
          quote_volume: dataset.quoteVolume5m.get(bar.timestamp_ms) ?? 0,
          normalized_5m_hash: dataset.hashes.normalized_5m,
        }
      : null,
  };
}

export function buildRelease03SignalStream(datasets) {
  const pairs = Object.keys(datasets).sort();
  const signals = pairs.flatMap((pair) => buildSignalRows(pair, datasets[pair].candles1h, RELEASE03_END_MS));
  signals.sort((left, right) => left.decision_ms - right.decision_ms || left.pair.localeCompare(right.pair));

  const sourceIdentity = pairs.map((pair) => ({
    pair,
    raw_trades_hash: datasets[pair].hashes.raw_trades,
    raw_5m_hash: datasets[pair].hashes.raw_5m,
    raw_1h_hash: datasets[pair].hashes.raw_1h,
    normalized_5m_hash: datasets[pair].hashes.normalized_5m,
    normalized_1h_hash: datasets[pair].hashes.normalized_1h,
    quote_volume_5m_hash: datasets[pair].hashes.quote_volume_5m,
  }));
  const opportunities = signals.map((signal) => ({
    opportunity_id: `${signal.pair}@${iso(signal.decision_ms)}`,
    pair: signal.pair,
    signal_candle_open_utc: iso(signal.signal_candle_open_ms),
    decision_time_utc: iso(signal.decision_ms),
    close: signal.close,
    ema20: signal.ema20,
    ema50: signal.ema50,
    previous_ema20: signal.previous_ema20,
    previous_ema50: signal.previous_ema50,
    transition: signal.transition,
    nominal: signalBucket(datasets[signal.pair], signal.decision_ms, NOMINAL_COSTS.latency_bars),
    stress: signalBucket(datasets[signal.pair], signal.decision_ms, STRESS_COSTS.latency_bars),
  }));
  const digestMaterial = {
    proof_window: {
      start_utc: RELEASE03_START_UTC,
      end_exclusive_utc: RELEASE03_END_UTC,
    },
    source_identity: sourceIdentity,
    opportunities,
  };
  return {
    signals,
    opportunities,
    source_identity: sourceIdentity,
    actionable_signal_opportunities: opportunities.filter((item) => item.transition !== "none").length,
    actionable_entry_opportunities: opportunities.filter((item) => item.transition === "bullish").length,
    digest: sha256Hex(canonicalSerialize(digestMaterial)),
  };
}

function replayConfig({ stake, costs, signalStream }) {
  const stakeLabel = stake === RELEASE03_CONTROL_STAKE ? "control-10pct" : "sensitivity-1pct";
  return {
    entryStakeFraction: stake,
    proofStartUtc: RELEASE03_START_UTC,
    proofEndUtc: RELEASE03_END_UTC,
    experimentId: RELEASE03_EXPERIMENT_ID,
    adapterVersion: "0.3.0",
    runId: `release03-${stakeLabel}-${costs.name}`,
    signals: signalStream.signals,
    includeLifecycleMetrics: true,
    signalStreamDigest: signalStream.digest,
  };
}

function runScenario(datasets, costs, stake, signalStream) {
  const config = replayConfig({ stake, costs, signalStream });
  const primary = replayPhase0A(datasets, costs, config);
  const replay = replayPhase0A(datasets, costs, config);
  validateLedgerRecords(primary.evidence);
  validateLedgerRecords(replay.evidence);
  if (primary.evidence_digest !== replay.evidence_digest) {
    throw new Error(`non-deterministic Release 0.3 evidence digest for ${config.runId}`);
  }
  return {
    ...primary,
    evidence_chain_valid: true,
    reproducible_digest: true,
  };
}

function sameNumber(left, right) {
  if (left === null || right === null) return left === right;
  return Math.abs(left - right) < 1e-9;
}

export function buildScaleConversionDiagnostics(signalStream, control, sensitivity, scenario) {
  const controlById = new Map(control.entry_opportunities.map((item) => [item.opportunity_id, item]));
  const sensitivityById = new Map(sensitivity.entry_opportunities.map((item) => [item.opportunity_id, item]));
  const entries = [];

  for (const opportunity of signalStream.opportunities.filter((item) => item.transition === "bullish")) {
    const controlEntry = controlById.get(opportunity.opportunity_id);
    const sensitivityEntry = sensitivityById.get(opportunity.opportunity_id);
    if (!controlEntry || !sensitivityEntry) {
      throw new Error(`missing paired entry diagnostic for ${opportunity.opportunity_id}`);
    }
    if (controlEntry.required_execution_time_utc !== sensitivityEntry.required_execution_time_utc) {
      throw new Error(`execution timestamp mismatch for ${opportunity.opportunity_id}`);
    }
    if (!sameNumber(controlEntry.execution_bucket_quote_volume, sensitivityEntry.execution_bucket_quote_volume)) {
      throw new Error(`execution quote-volume mismatch for ${opportunity.opportunity_id}`);
    }
    const scaleConversion = controlEntry.liquidity_result === "liquidity_limit"
      && sensitivityEntry.entry_result === "accepted";
    entries.push({
      opportunity_id: opportunity.opportunity_id,
      pair: opportunity.pair,
      decision_time_utc: opportunity.decision_time_utc,
      required_execution_time_utc: controlEntry.required_execution_time_utc,
      execution_bucket_quote_volume: controlEntry.execution_bucket_quote_volume,
      control_10pct_desired_order_notional: controlEntry.desired_order_notional,
      sensitivity_1pct_desired_order_notional: sensitivityEntry.desired_order_notional,
      control_10pct_liquidity_result: controlEntry.liquidity_result,
      sensitivity_1pct_liquidity_result: sensitivityEntry.liquidity_result,
      control_10pct_entry_result: controlEntry.entry_result,
      sensitivity_1pct_entry_result: sensitivityEntry.entry_result,
      scale_conversion_entry: scaleConversion,
    });
  }

  return {
    scenario,
    entry_opportunity_count: entries.length,
    scale_conversion_entries: entries.filter((entry) => entry.scale_conversion_entry).length,
    entries,
    digest: sha256Hex(canonicalSerialize(entries)),
  };
}

function transitionCoverage(run) {
  const transitions = run.state_transitions;
  return {
    cash: transitions.some((item) => Math.abs(item.cash_after - item.cash_before) > 1e-12),
    position: transitions.some((item) => canonicalSerialize(item.position_after) !== canonicalSerialize(item.position_before)),
    equity: transitions.some((item) => Math.abs(item.equity_after - item.equity_before) > 1e-12),
    exposure: transitions.some((item) => Math.abs(item.exposure_after - item.exposure_before) > 1e-12),
  };
}

function summarizeScenario(run, scaleDiagnostics) {
  return {
    ...run.metrics,
    scale_conversion_entries: scaleDiagnostics.scale_conversion_entries,
    evidence_chain_valid: run.evidence_chain_valid,
    reproducible_canonical_digest: run.reproducible_digest,
    canonical_substantive_digest: run.evidence_digest,
    transition_coverage: transitionCoverage(run),
  };
}

function lifecyclePass(summary) {
  return summary.scale_conversion_entries >= 1
    && summary.accepted_entries >= 1
    && summary.accepted_exits >= 1
    && summary.complete_round_trips >= 1
    && summary.execution_cost_drag > 0
    && summary.transition_coverage.cash
    && summary.transition_coverage.position
    && summary.transition_coverage.equity
    && summary.transition_coverage.exposure
    && summary.evidence_chain_valid
    && summary.reproducible_canonical_digest;
}

export function runRelease03ExecutabilitySensitivity(datasets) {
  const signalStream = buildRelease03SignalStream(datasets);

  const controlNominal = runScenario(datasets, NOMINAL_COSTS, RELEASE03_CONTROL_STAKE, signalStream);
  const controlStress = runScenario(datasets, STRESS_COSTS, RELEASE03_CONTROL_STAKE, signalStream);
  const sensitivityNominal = runScenario(datasets, NOMINAL_COSTS, RELEASE03_SENSITIVITY_STAKE, signalStream);
  const sensitivityStress = runScenario(datasets, STRESS_COSTS, RELEASE03_SENSITIVITY_STAKE, signalStream);

  const scaleNominal = buildScaleConversionDiagnostics(
    signalStream,
    controlNominal,
    sensitivityNominal,
    "nominal",
  );
  const scaleStress = buildScaleConversionDiagnostics(
    signalStream,
    controlStress,
    sensitivityStress,
    "stress",
  );

  const summaries = {
    control_10pct_nominal: summarizeScenario(controlNominal, scaleNominal),
    control_10pct_stress: summarizeScenario(controlStress, scaleStress),
    sensitivity_1pct_nominal: summarizeScenario(sensitivityNominal, scaleNominal),
    sensitivity_1pct_stress: summarizeScenario(sensitivityStress, scaleStress),
  };
  const nominalPass = lifecyclePass(summaries.sensitivity_1pct_nominal);
  const stressPass = lifecyclePass(summaries.sensitivity_1pct_stress);
  const classification = nominalPass && stressPass ? "FULL PASS" : nominalPass || stressPass ? "PARTIAL PASS" : "NEGATIVE";

  return {
    signal_stream: signalStream,
    scale_conversion: {
      nominal: scaleNominal,
      stress: scaleStress,
    },
    runs: {
      control_10pct_nominal: controlNominal,
      control_10pct_stress: controlStress,
      sensitivity_1pct_nominal: sensitivityNominal,
      sensitivity_1pct_stress: sensitivityStress,
    },
    summaries,
    lifecycle_pass: {
      sensitivity_1pct_nominal: nominalPass,
      sensitivity_1pct_stress: stressPass,
    },
    classification,
  };
}
