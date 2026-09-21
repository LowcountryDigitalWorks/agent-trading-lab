import { canonicalSerialize, sha256Hex } from "./canonical.mjs";
import { validateCandidateEnvelope, validateDecisionRecord, validateFillRecord, validateGateResult } from "./contracts.mjs";
import { buildEvidenceRecord, canonicalLedgerDigest, validateLedgerRecords } from "./ledger.mjs";
import { PROOF_END_MS, PROOF_START_MS, PROOF_START_UTC, PROOF_END_UTC, TIMEFRAME_MS } from "./freqtrade-artifacts.mjs";

export const STARTING_EQUITY = 10_000;
export const ENTRY_STAKE_FRACTION = 0.10;
export const MAX_EXPOSURE_FRACTION = 0.20;
export const DAILY_LOSS_FRACTION = 0.02;
export const HARD_DRAWDOWN_FRACTION = 0.10;
export const LIQUIDITY_FRACTION = 0.001;
export const NOMINAL_COSTS = Object.freeze({ name: "nominal", fee_bps: 10, half_spread_bps: 2, slippage_bps: 3, latency_bars: 0 });
export const STRESS_COSTS = Object.freeze({ name: "stress", fee_bps: 10, half_spread_bps: 5, slippage_bps: 10, latency_bars: 1 });

function fail(message) { throw new TypeError(message); }
function iso(ms) { return new Date(ms).toISOString(); }
function clampTiny(value) { return Math.abs(value) < 1e-12 ? 0 : value; }

export function emaSeries(candles, period) {
  if (!Number.isInteger(period) || period < 2) fail("EMA period must be an integer >= 2");
  if (!Array.isArray(candles)) fail("candles must be an array");
  const output = Array(candles.length).fill(null);
  if (candles.length < period) return output;
  let sum = 0;
  for (let index = 0; index < period; index += 1) sum += candles[index].close;
  let ema = sum / period;
  output[period - 1] = ema;
  const alpha = 2 / (period + 1);
  for (let index = period; index < candles.length; index += 1) {
    ema = candles[index].close * alpha + ema * (1 - alpha);
    output[index] = ema;
  }
  return output;
}

export function buildSignalRows(pair, candles1h) {
  const ema20 = emaSeries(candles1h, 20);
  const ema50 = emaSeries(candles1h, 50);
  const rows = [];
  for (let index = 50; index < candles1h.length; index += 1) {
    const candle = candles1h[index];
    const decisionMs = candle.timestamp_ms + TIMEFRAME_MS["1h"];
    if (decisionMs >= PROOF_END_MS) break;
    const previous20 = ema20[index - 1];
    const previous50 = ema50[index - 1];
    const current20 = ema20[index];
    const current50 = ema50[index];
    if ([previous20, previous50, current20, current50].some((value) => value === null)) continue;
    let transition = "none";
    if (previous20 <= previous50 && current20 > current50) transition = "bullish";
    else if (previous20 >= previous50 && current20 < current50) transition = "bearish";
    rows.push({
      pair,
      candle_index: index,
      signal_candle_open_ms: candle.timestamp_ms,
      decision_ms: decisionMs,
      close: candle.close,
      ema20: current20,
      ema50: current50,
      previous_ema20: previous20,
      previous_ema50: previous50,
      transition,
    });
  }
  return rows;
}

export function nextExecutionBar(candles5m, decisionMs, latencyBars = 0) {
  if (!Number.isInteger(latencyBars) || latencyBars < 0) fail("latencyBars must be a non-negative integer");
  const targetMs = decisionMs + TIMEFRAME_MS["5m"] * (latencyBars + 1);
  let low = 0;
  let high = candles5m.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (candles5m[middle].timestamp_ms < targetMs) low = middle + 1;
    else high = middle;
  }
  return low < candles5m.length && candles5m[low].timestamp_ms === targetMs ? candles5m[low] : null;
}

export function executionTerms(side, referencePrice, quantity, costs) {
  if (!["BUY", "SELL"].includes(side)) fail("side must be BUY or SELL");
  if (!(referencePrice > 0) || !(quantity > 0)) fail("reference price and quantity must be positive");
  const spreadRate = costs.half_spread_bps / 10_000;
  const slippageRate = costs.slippage_bps / 10_000;
  const feeRate = costs.fee_bps / 10_000;
  const priceRate = spreadRate + slippageRate;
  const effectivePrice = side === "BUY" ? referencePrice * (1 + priceRate) : referencePrice * (1 - priceRate);
  const spreadCost = quantity * referencePrice * spreadRate;
  const slippageCost = quantity * referencePrice * slippageRate;
  const fee = quantity * effectivePrice * feeRate;
  const totalCostDrag = spreadCost + slippageCost + fee;
  return { effectivePrice, spreadCost, slippageCost, fee, totalCostDrag };
}

export function assertCostModelMonotonic(referencePrice = 100, quantity = 1) {
  for (const side of ["BUY", "SELL"]) {
    const nominal = executionTerms(side, referencePrice, quantity, NOMINAL_COSTS);
    const stress = executionTerms(side, referencePrice, quantity, STRESS_COSTS);
    if (stress.totalCostDrag < nominal.totalCostDrag) throw new Error(`stress cost drag improved for ${side}`);
    if (side === "BUY" && stress.effectivePrice < nominal.effectivePrice) throw new Error("stress BUY effective price improved");
    if (side === "SELL" && stress.effectivePrice > nominal.effectivePrice) throw new Error("stress SELL effective price improved");
  }
  return true;
}

function latestCloseAtDecision(candles, decisionMs) {
  let low = 0;
  let high = candles.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const candleCloseMs = candles[middle].timestamp_ms + TIMEFRAME_MS["1h"];
    if (candleCloseMs <= decisionMs) low = middle + 1;
    else high = middle;
  }
  const index = low - 1;
  return index >= 0 ? candles[index].close : null;
}

function markPortfolio(state, datasets, decisionMs) {
  let positionsValue = 0;
  for (const [pair, position] of Object.entries(state.positions)) {
    if (!position) continue;
    const mark = latestCloseAtDecision(datasets[pair].candles1h, decisionMs);
    if (mark === null) fail(`missing mark price for ${pair} at ${iso(decisionMs)}`);
    positionsValue += position.quantity * mark;
  }
  return state.cash + positionsValue;
}

function exposureAtDecision(state, datasets, decisionMs) {
  let exposure = 0;
  for (const [pair, position] of Object.entries(state.positions)) {
    if (!position) continue;
    const mark = latestCloseAtDecision(datasets[pair].candles1h, decisionMs);
    exposure += position.quantity * mark;
  }
  return exposure;
}

export function evaluateEntryRisk({ currentEquity, dayStartEquity, peakEquity, currentExposure, desiredNotional, experimentHalted = false }) {
  if (experimentHalted) return "hard_drawdown_gate";
  const drawdown = peakEquity > 0 ? (peakEquity - currentEquity) / peakEquity : 0;
  if (drawdown >= HARD_DRAWDOWN_FRACTION) return "hard_drawdown_gate";
  const dailyLoss = dayStartEquity > 0 ? (dayStartEquity - currentEquity) / dayStartEquity : 0;
  if (dailyLoss >= DAILY_LOSS_FRACTION) return "daily_loss_gate";
  if (currentEquity <= 0 || (currentExposure + desiredNotional) / currentEquity > MAX_EXPOSURE_FRACTION + 1e-12) return "aggregate_exposure_gate";
  return null;
}

function appendEvidence(records, runId, eventType, payload, recordedAtUtc) {
  const previous = records.length === 0 ? null : records.at(-1).record_hash;
  records.push(buildEvidenceRecord({
    run_id: runId,
    sequence: records.length,
    event_type: eventType,
    recorded_at_utc: recordedAtUtc,
    payload,
    prev_record_hash: previous,
  }));
}

function createCandidate(signal, dataset, existingPosition) {
  const decisionUtc = iso(signal.decision_ms);
  const stateMaterial = {
    pair: signal.pair,
    signal_candle_open_utc: iso(signal.signal_candle_open_ms),
    decision_utc: decisionUtc,
    close: signal.close,
    ema20: signal.ema20,
    ema50: signal.ema50,
    previous_ema20: signal.previous_ema20,
    previous_ema50: signal.previous_ema50,
    transition: signal.transition,
    existing_position: existingPosition,
    source_hash: dataset.hashes.normalized_1h,
  };
  const candidate = {
    schema_version: "candidate-envelope.v1",
    experiment_id: "phase0a-kraken-2026-08",
    track: "0A",
    candidate_id: `${signal.pair}@${decisionUtc}`,
    event_time_utc: iso(signal.signal_candle_open_ms),
    decision_time_utc: decisionUtc,
    observation_cutoff_utc: decisionUtc,
    source_id: "freqtrade-kraken-public-trades",
    source_version: "freqtrade-2026.8@9f10e357a93c1dcf10c2a2b367659214d89c073e",
    venue: "Kraken",
    instrument_id: signal.pair,
    instrument_type: "spot",
    state_hash: sha256Hex(canonicalSerialize(stateMaterial)),
    features: [
      { name: "ema20", value: signal.ema20, available_at_utc: decisionUtc },
      { name: "ema50", value: signal.ema50, available_at_utc: decisionUtc },
      { name: "previous_ema20", value: signal.previous_ema20, available_at_utc: decisionUtc },
      { name: "previous_ema50", value: signal.previous_ema50, available_at_utc: decisionUtc },
    ],
    market_state: {
      signal_candle_open_utc: iso(signal.signal_candle_open_ms),
      signal_candle_close: signal.close,
      transition: signal.transition,
      existing_position: existingPosition,
    },
    context_refs: [
      { ref_id: `normalized-1h:${dataset.hashes.normalized_1h}`, available_at_utc: decisionUtc },
    ],
  };
  return validateCandidateEnvelope(candidate);
}

function createDecision(candidate, action, transition) {
  const output = { action, transition };
  const decision = {
    candidate_id: candidate.candidate_id,
    adapter_id: "phase0a-ema20-ema50",
    adapter_version: "0.2.0",
    action,
    instrument_side: null,
    p_yes: null,
    status: "ok",
    model_id: null,
    model_version: null,
    prompt_version: null,
    schema_version: "decision-record.v1",
    input_hash: candidate.state_hash,
    output_hash: sha256Hex(canonicalSerialize(output)),
    latency_ms: 0,
    input_tokens: null,
    output_tokens: null,
    incremental_cost_usd: 0,
  };
  return validateDecisionRecord(decision);
}

function createGate(decision, accepted, action, reasonCode, reasonDetail = null) {
  return validateGateResult({
    schema_version: "gate-result.v1",
    candidate_id: decision.candidate_id,
    decision_output_hash: decision.output_hash,
    accepted,
    action,
    reason_code: reasonCode,
    reason_detail: reasonDetail,
  });
}

function createFill({ candidateId, actionId, side, bar, quantity, terms, scenario, sourceHash }) {
  return validateFillRecord({
    schema_version: "fill-record.v1",
    candidate_id: candidateId,
    action_id: actionId,
    execution_time_utc: iso(bar.timestamp_ms),
    side,
    requested_qty: quantity,
    filled_qty: quantity,
    reference_price: bar.open,
    effective_price: terms.effectivePrice,
    fee: terms.fee,
    spread_cost: terms.spreadCost,
    slippage_cost: terms.slippageCost,
    fill_status: "filled",
    execution_mode: `historical-replay-${scenario}`,
    source_hash: sourceHash,
  });
}

function finalMark(state, datasets) {
  let value = state.cash;
  for (const [pair, position] of Object.entries(state.positions)) {
    if (!position) continue;
    const last = datasets[pair].candles5m.at(-1);
    value += position.quantity * last.close;
  }
  return value;
}

export function replayPhase0A(datasets, costs) {
  assertCostModelMonotonic();
  const pairs = Object.keys(datasets).sort();
  const signals = pairs.flatMap((pair) => buildSignalRows(pair, datasets[pair].candles1h));
  signals.sort((left, right) => left.decision_ms - right.decision_ms || left.pair.localeCompare(right.pair));
  const runId = `phase0a-${costs.name}-kraken-2026-08`;
  const evidence = [];
  appendEvidence(evidence, runId, "run_started", { scenario: costs.name, proof_window: { start_utc: PROOF_START_UTC, end_utc: PROOF_END_UTC } }, PROOF_START_UTC);
  const state = {
    cash: STARTING_EQUITY,
    positions: Object.fromEntries(pairs.map((pair) => [pair, null])),
    dayKey: null,
    dayStartEquity: STARTING_EQUITY,
    peakEquity: STARTING_EQUITY,
    experimentHalted: false,
  };
  let maxDrawdown = 0;
  let exposureSum = 0;
  let exposureSamples = 0;
  let maxExposureFraction = 0;
  let turnover = 0;
  let executionCostDrag = 0;
  let fillCount = 0;
  let rejectedActionCount = 0;
  const rejectionReasons = {};
  const equityCurve = [];

  for (const signal of signals) {
    const currentEquity = markPortfolio(state, datasets, signal.decision_ms);
    const dayKey = iso(signal.decision_ms).slice(0, 10);
    if (state.dayKey !== dayKey) {
      state.dayKey = dayKey;
      state.dayStartEquity = currentEquity;
    }
    state.peakEquity = Math.max(state.peakEquity, currentEquity);
    const drawdown = state.peakEquity > 0 ? (state.peakEquity - currentEquity) / state.peakEquity : 0;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
    if (drawdown >= HARD_DRAWDOWN_FRACTION) state.experimentHalted = true;
    const currentExposure = exposureAtDecision(state, datasets, signal.decision_ms);
    const exposureFraction = currentEquity > 0 ? currentExposure / currentEquity : 0;
    exposureSum += exposureFraction;
    exposureSamples += 1;
    maxExposureFraction = Math.max(maxExposureFraction, exposureFraction);
    equityCurve.push({ timestamp_utc: iso(signal.decision_ms), equity: currentEquity });

    const existingPosition = Boolean(state.positions[signal.pair]);
    const candidate = createCandidate(signal, datasets[signal.pair], existingPosition);
    let desiredAction = "HOLD";
    if (signal.transition === "bullish" && !existingPosition) desiredAction = "BUY";
    else if (signal.transition === "bearish" && existingPosition) desiredAction = "SELL";
    const decision = createDecision(candidate, desiredAction, signal.transition);
    appendEvidence(evidence, runId, "candidate", candidate, candidate.decision_time_utc);
    appendEvidence(evidence, runId, "decision", decision, candidate.decision_time_utc);

    let gate;
    let fill = null;
    if (desiredAction === "HOLD") {
      gate = createGate(decision, true, "HOLD", "no_transition_action");
    } else {
      const bar = nextExecutionBar(datasets[signal.pair].candles5m, signal.decision_ms, costs.latency_bars);
      let rejectReason = null;
      let rejectDetail = null;
      if (!bar) {
        rejectReason = "missing_execution_data";
      } else {
        const quoteVolume = datasets[signal.pair].quoteVolume5m.get(bar.timestamp_ms) ?? 0;
        const position = state.positions[signal.pair];
        const desiredNotional = desiredAction === "BUY" ? currentEquity * ENTRY_STAKE_FRACTION : position.quantity * bar.open;
        if (!(quoteVolume > 0)) {
          rejectReason = "missing_quote_volume";
        } else if (desiredNotional > quoteVolume * LIQUIDITY_FRACTION) {
          rejectReason = "liquidity_limit";
          rejectDetail = `order_notional=${desiredNotional};limit=${quoteVolume * LIQUIDITY_FRACTION}`;
        } else if (desiredAction === "BUY") {
          rejectReason = evaluateEntryRisk({
            currentEquity,
            dayStartEquity: state.dayStartEquity,
            peakEquity: state.peakEquity,
            currentExposure,
            desiredNotional,
            experimentHalted: state.experimentHalted,
          });
        }

        if (!rejectReason) {
          const position = state.positions[signal.pair];
          const quantity = desiredAction === "BUY" ? (currentEquity * ENTRY_STAKE_FRACTION) / bar.open : position.quantity;
          const terms = executionTerms(desiredAction, bar.open, quantity, costs);
          fill = createFill({
            candidateId: candidate.candidate_id,
            actionId: `${candidate.candidate_id}:${costs.name}`,
            side: desiredAction,
            bar,
            quantity,
            terms,
            scenario: costs.name,
            sourceHash: datasets[signal.pair].hashes.normalized_5m,
          });
          const referenceNotional = quantity * bar.open;
          turnover += referenceNotional;
          executionCostDrag += terms.totalCostDrag;
          if (desiredAction === "BUY") {
            state.cash -= quantity * terms.effectivePrice + terms.fee;
            state.positions[signal.pair] = { quantity, entry_reference_price: bar.open, entry_effective_price: terms.effectivePrice, entered_at_utc: fill.execution_time_utc };
          } else {
            state.cash += quantity * terms.effectivePrice - terms.fee;
            state.positions[signal.pair] = null;
          }
          fillCount += 1;
          gate = createGate(decision, true, desiredAction, "accepted");
        }
      }
      if (rejectReason) {
        rejectedActionCount += 1;
        rejectionReasons[rejectReason] = (rejectionReasons[rejectReason] ?? 0) + 1;
        gate = createGate(decision, false, "SKIP", rejectReason, rejectDetail);
      }
    }
    appendEvidence(evidence, runId, "gate", gate, candidate.decision_time_utc);
    if (fill) appendEvidence(evidence, runId, "fill", fill, fill.execution_time_utc);
  }

  const finalEquity = finalMark(state, datasets);
  state.peakEquity = Math.max(state.peakEquity, finalEquity);
  maxDrawdown = Math.max(maxDrawdown, state.peakEquity > 0 ? (state.peakEquity - finalEquity) / state.peakEquity : 0);
  const metrics = {
    scenario: costs.name,
    starting_equity: STARTING_EQUITY,
    ending_equity: finalEquity,
    adjusted_net_return: clampTiny(finalEquity / STARTING_EQUITY - 1),
    turnover: turnover / STARTING_EQUITY,
    trade_count: fillCount,
    execution_cost_drag: executionCostDrag,
    execution_cost_drag_fraction: executionCostDrag / STARTING_EQUITY,
    maximum_drawdown: maxDrawdown,
    average_exposure: exposureSamples === 0 ? 0 : exposureSum / exposureSamples,
    maximum_exposure: maxExposureFraction,
    rejected_action_count: rejectedActionCount,
    accepted_fill_count: fillCount,
    rejected_fill_count: rejectedActionCount,
    candidate_count: signals.length,
    evidence_count_before_metrics: evidence.length,
    open_positions_at_end: Object.entries(state.positions).filter(([, position]) => Boolean(position)).map(([pair]) => pair),
    rejection_reasons: rejectionReasons,
  };
  appendEvidence(evidence, runId, "metric", metrics, PROOF_END_UTC);
  appendEvidence(evidence, runId, "run_closed", { scenario: costs.name, status: "completed" }, PROOF_END_UTC);
  validateLedgerRecords(evidence);
  return {
    metrics: { ...metrics, evidence_count: evidence.length },
    evidence,
    evidence_digest: canonicalLedgerDigest(evidence),
    equity_curve: equityCurve,
  };
}

export function runPhase0AProof(datasets) {
  const nominal = replayPhase0A(datasets, NOMINAL_COSTS);
  const stress = replayPhase0A(datasets, STRESS_COSTS);
  return {
    nominal,
    stress,
    cost_model_monotonicity_pass: assertCostModelMonotonic(),
    comparison: {
      adjusted_net_return_delta_stress_minus_nominal: stress.metrics.adjusted_net_return - nominal.metrics.adjusted_net_return,
      execution_cost_drag_delta_stress_minus_nominal: stress.metrics.execution_cost_drag - nominal.metrics.execution_cost_drag,
      note: "Stress latency may change market reference prices; cost-model monotonicity is separately asserted at identical reference price and quantity.",
    },
  };
}
