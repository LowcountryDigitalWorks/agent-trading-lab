import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  COHORT_FLOORS,
  CRYPTOSTRUCT_ALLOWED_TOOLS,
  CRYPTOSTRUCT_MCP_ENDPOINT,
  CRYPTOSTRUCT_UNDERLYING_VENUE,
  QUALITY_GATE,
  applyIndependentResolution,
  assertPublicEvidenceSanitized,
  buildPrivateCryptoStructEvidenceEvent,
  buildSanitizedPublicEvidence,
  classifyCryptoStructAccessFailure,
  createCryptoStructSourceAdapter,
  createIndependentEventSpec,
  createResolutionState,
  cryptoStructMcpContract,
  deduplicateEventCandidates,
  estimateCohortThroughput,
  evaluateCryptoStructSourceQuality,
  independentEventSpecHash,
  parseGetInstrumentResult,
  parseGetMarketSnapshotResult,
  parseMcpToolEnvelope,
  parseSearchInstrumentsResult,
  plannedCryptoStructCutoffs,
  selectCryptoStructInstrument,
  treatmentContextFromIndependentSpec,
  validateCutoffTiming,
  validateFrozenCryptoStructSelection,
  validateIndependentEventSpec,
  validatePolymarketBinaryOrientation,
} from "../src/cryptostruct-source.mjs";
import { sha256Hex } from "../src/canonical.mjs";
import { computeEvidenceRecordHash, validateLedgerRecords } from "../src/ledger.mjs";

const FIXTURES = new URL("./fixtures/", import.meta.url);
const DEADLINE = "2026-10-01T21:00:00.000Z";
const CUTOFF = "2026-09-30T21:00:00.000Z";

async function fixture(name) {
  return JSON.parse(await readFile(new URL(name, FIXTURES), "utf8"));
}

function spec(overrides = {}) {
  return createIndependentEventSpec({
    event_id: "weather-charleston-2026-10-01-high90",
    canonical_question: "Will the official high temperature at the declared station reach at least 90 F on 2026-10-01?",
    yes_condition: "YES if the official daily high is at least 90 F.",
    no_condition: "NO if the official daily high is below 90 F.",
    category: "WEATHER_CLIMATE",
    deadline_utc: DEADLINE,
    resolution_authority: "National Weather Service",
    resolution_reference: "https://weather.gov/example/daily-climate-report",
    criteria_hash: sha256Hex("frozen independent criteria v1"),
    ...overrides,
  });
}

function instrument(overrides = {}) {
  return {
    instrument_id: "pm-weather-yes-001",
    code: "PM-WEATHER-YES-001",
    venue: "polymarket",
    instrument_class: "prediction_binary",
    state: "open",
    event_cluster_id: "weather-charleston-2026-10-01",
    question: "Will the official high temperature reach at least 90 F?",
    orientation: "YES",
    close_time_utc: DEADLINE,
    price_semantics: "probability_0_1",
    provenance: { source: "CryptoStruct", source_version: "mcp-free", stable_id: true },
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  return {
    instrument_id: "pm-weather-yes-001",
    captured_at_utc: "2026-09-30T21:00:00.020Z",
    last_price: 0.61,
    trades_60m: 8,
    turnover_usd_60m: 240.5,
    spread_bps: 500,
    top1_depth_usd: 75,
    source_surface: "get_market_snapshot",
    source_version: "mcp-free",
    ...overrides,
  };
}

function qualityArgs(overrides = {}) {
  const s = spec();
  return {
    spec: s,
    frozen_spec_hash: independentEventSpecHash(s),
    frozen_instrument_id: "pm-weather-yes-001",
    instrument: instrument(),
    snapshot: snapshot(),
    cutoff_utc: CUTOFF,
    request_start_utc: CUTOFF,
    request_complete_utc: "2026-09-30T21:00:00.050Z",
    ...overrides,
  };
}

function privatePayload(overrides = {}) {
  const s = spec();
  const ctx = treatmentContextFromIndependentSpec(s, CUTOFF);
  return {
    schema_version: "cryptostruct-private-evidence.v1",
    independent_event_id: s.event_id,
    independent_event_spec_hash: independentEventSpecHash(s),
    cryptostruct_instrument_id: "pm-weather-yes-001",
    underlying_venue: CRYPTOSTRUCT_UNDERLYING_VENUE,
    orientation: "YES",
    category: s.category,
    source_tool: "get_market_snapshot",
    source_version: "mcp-free",
    scheduled_cutoff_utc: CUTOFF,
    request_start_utc: CUTOFF,
    request_complete_utc: "2026-09-30T21:00:00.050Z",
    capture_timestamp_utc: "2026-09-30T21:00:00.020Z",
    p_control: 0.61,
    trades_60m: 8,
    turnover_usd_60m: 240.5,
    spread_bps: 500,
    top1_depth_usd: 75,
    eligibility: true,
    rejection_reason: null,
    response_content_hash: sha256Hex("synthetic response"),
    frozen_deadline_utc: DEADLINE,
    official_outcome: null,
    resolution_evidence_hash: null,
    treatment_context_hash: ctx.context_hash,
    future_model_config_hash: null,
    future_p_yes: null,
    future_treatment_status: null,
    future_latency_ms: null,
    future_input_tokens: null,
    future_output_tokens: null,
    future_cost_usd: null,
    ...overrides,
  };
}

test("CryptoStruct contract is keyless docs-only and limited to three approved MCP tools", () => {
  const contract = cryptoStructMcpContract();
  assert.equal(contract.endpoint, CRYPTOSTRUCT_MCP_ENDPOINT);
  assert.equal(contract.free_tier, "keyless");
  assert.equal(contract.operational_access_authorized, false);
  assert.deepEqual(contract.allowed_tools, CRYPTOSTRUCT_ALLOWED_TOOLS);
  assert.equal(contract.documented_units.turnover, "USD");
  assert.equal(contract.documented_units.depth, "USD");
});

test("source adapter refuses operational tool access before owner license acceptance", async () => {
  const adapter = createCryptoStructSourceAdapter({ invokeTool: async () => ({}) });
  await assert.rejects(() => adapter.searchInstruments({ query: "weather" }), /OWNER_LICENSE_ACCEPTANCE_REQUIRED/u);
  await assert.rejects(() => adapter.getInstrument({ instrument_id: "x" }), /OWNER_LICENSE_ACCEPTANCE_REQUIRED/u);
  await assert.rejects(() => adapter.getMarketSnapshot({ instrument_id: "x" }), /OWNER_LICENSE_ACCEPTANCE_REQUIRED/u);
});

test("synthetic MCP envelopes parse both structuredContent and JSON text content", async () => {
  const search = parseSearchInstrumentsResult(parseMcpToolEnvelope(await fixture("cryptostruct-search-instruments.synthetic.json"), "search_instruments"));
  const master = parseGetInstrumentResult(parseMcpToolEnvelope(await fixture("cryptostruct-get-instrument.synthetic.json"), "get_instrument"));
  const snap = parseGetMarketSnapshotResult(parseMcpToolEnvelope(await fixture("cryptostruct-market-snapshot.synthetic.json"), "get_market_snapshot"));
  assert.equal(search[0].venue, "polymarket");
  assert.equal(master.instrument_id, "pm-weather-yes-001");
  assert.equal(master.price_semantics, "probability_0_1");
  assert.equal(snap.last_price, 0.61);
  assert.equal(snap.turnover_usd_60m, 240.5);
});

test("undocumented or malformed MCP envelope fields fail closed", () => {
  assert.throws(() => parseMcpToolEnvelope({ content: [{ type: "text", text: "not-json" }] }, "get_market_snapshot"), /not JSON/u);
  assert.throws(() => parseGetMarketSnapshotResult({ snapshot: { ...snapshot(), undocumented: true } }), /unknown field/u);
  assert.throws(() => parseGetMarketSnapshotResult({ snapshot: { ...snapshot(), last_price: 2 } }), /\[0,1\]/u);
});

test("IndependentEventSpec is frozen before T-24h and accepts only allowed categories", () => {
  const s = spec();
  assert.equal(validateIndependentEventSpec(s), s);
  assert.match(independentEventSpecHash(s), /^[a-f0-9]{64}$/u);
  assert.deepEqual(s.allowed_cutoffs, ["T-24h", "T-6h", "T-1h"]);
  assert.throws(() => spec({ category: "SPORTS" }), /category not allowed/u);
});

test("planned cutoff schedule is exactly T-24h/T-6h/T-1h", () => {
  const schedule = plannedCryptoStructCutoffs(DEADLINE);
  assert.deepEqual(schedule.map((x) => x.label), ["T-24h", "T-6h", "T-1h"]);
  assert.equal(schedule[0].cutoff_utc, CUTOFF);
});

test("treatment context contains only independently sourced fields and no CryptoStruct-derived values", () => {
  const result = treatmentContextFromIndependentSpec(spec(), CUTOFF);
  const serialized = JSON.stringify(result.context);
  for (const forbidden of ["CryptoStruct", "Polymarket", "instrument", "last_price", "p_control", "spread", "turnover", "depth", "liquidity"]) {
    assert.equal(serialized.includes(forbidden), false, `unexpected treatment leak: ${forbidden}`);
  }
  assert.match(result.context_hash, /^[a-f0-9]{64}$/u);
});

test("Polymarket binary YES/Up orientation is required and ambiguous orientation fails closed", () => {
  assert.equal(validatePolymarketBinaryOrientation(instrument()).valid, true);
  assert.equal(validatePolymarketBinaryOrientation(instrument({ orientation: "UP" })).valid, true);
  assert.equal(validatePolymarketBinaryOrientation(instrument({ orientation: "NO" })).reason, "orientation_ambiguous");
  assert.equal(validatePolymarketBinaryOrientation(instrument({ venue: "kalshi" })).reason, "wrong_venue");
  assert.equal(validatePolymarketBinaryOrientation(instrument({ price_semantics: "unknown" })).reason, "price_semantics_unqualified");
});

test("exact p_control equals last_price for an eligible source snapshot", () => {
  const result = evaluateCryptoStructSourceQuality(qualityArgs());
  assert.equal(result.eligible, true);
  assert.equal(result.p_control, snapshot().last_price);
  assert.equal(result.p_control, 0.61);
});

test("cutoff timing requires exact request start and completion no later than +60 seconds", () => {
  assert.equal(validateCutoffTiming({ cutoff_utc:CUTOFF, request_start_utc:CUTOFF, request_complete_utc:"2026-09-30T21:00:59.999Z", snapshot_capture_utc:"2026-09-30T21:00:30.000Z" }).valid, true);
  assert.equal(validateCutoffTiming({ cutoff_utc:CUTOFF, request_start_utc:"2026-09-30T21:00:00.001Z", request_complete_utc:"2026-09-30T21:00:01.000Z", snapshot_capture_utc:"2026-09-30T21:00:00.500Z" }).reason, "request_not_started_at_cutoff");
  assert.equal(validateCutoffTiming({ cutoff_utc:CUTOFF, request_start_utc:CUTOFF, request_complete_utc:"2026-09-30T21:01:00.001Z", snapshot_capture_utc:"2026-09-30T21:00:30.000Z" }).reason, "response_outside_cutoff_window");
  assert.equal(validateCutoffTiming({ cutoff_utc:CUTOFF, request_start_utc:CUTOFF, request_complete_utc:"2026-09-30T21:00:30.000Z", snapshot_capture_utc:"2026-09-30T20:59:59.999Z" }).reason, "stale_or_future_snapshot_capture");
});

test("quality gate rejects low trades, turnover, depth, wide spread, unresolved state, changed criteria, and missing provenance", () => {
  assert.equal(evaluateCryptoStructSourceQuality(qualityArgs({ snapshot:snapshot({trades_60m:QUALITY_GATE.min_trades_60m-1}) })).reason, "low_trades_60m");
  assert.equal(evaluateCryptoStructSourceQuality(qualityArgs({ snapshot:snapshot({turnover_usd_60m:QUALITY_GATE.min_turnover_usd_60m-0.01}) })).reason, "low_turnover_60m");
  assert.equal(evaluateCryptoStructSourceQuality(qualityArgs({ snapshot:snapshot({top1_depth_usd:QUALITY_GATE.min_top1_depth_usd-0.01}) })).reason, "low_top1_depth");
  assert.equal(evaluateCryptoStructSourceQuality(qualityArgs({ snapshot:snapshot({spread_bps:QUALITY_GATE.max_spread_bps+0.01}) })).reason, "invalid_or_wide_spread");
  assert.equal(evaluateCryptoStructSourceQuality(qualityArgs({ instrument:instrument({state:"resolved"}) })).reason, "event_not_open_or_unresolved");
  assert.equal(evaluateCryptoStructSourceQuality(qualityArgs({ frozen_spec_hash:sha256Hex("different") })).reason, "independent_criteria_changed");
  assert.equal(evaluateCryptoStructSourceQuality(qualityArgs({ instrument:instrument({provenance:{source:"",source_version:"",stable_id:true}}) })).reason, "provenance_missing");
});

test("no-trade snapshot is fail-closed rather than substituted", () => {
  const result = evaluateCryptoStructSourceQuality(qualityArgs({ snapshot:snapshot({trades_60m:0,turnover_usd_60m:0}) }));
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "low_trades_60m");
});

test("selector uses turnover, trades, spread, depth, then lexical stable id", () => {
  const s = spec();
  const mk = (id, q) => ({
    spec:s,
    instrument:instrument({instrument_id:id,code:id}),
    eligibility:{eligible:true,orientation:"YES",quality:q},
  });
  const selected=selectCryptoStructInstrument([
    mk("z",{turnover_usd_60m:200,trades_60m:10,spread_bps:100,top1_depth_usd:100}),
    mk("b",{turnover_usd_60m:300,trades_60m:9,spread_bps:200,top1_depth_usd:90}),
    mk("a",{turnover_usd_60m:300,trades_60m:9,spread_bps:200,top1_depth_usd:90}),
  ]);
  assert.equal(selected.instrument_id,"a");
  assert.equal(selected.selected_at_cutoff,"T-24h");
});

test("frozen selector does not switch later and changed instrument/criteria invalidate", () => {
  const s = spec();
  const chosen=selectCryptoStructInstrument([{spec:s,instrument:instrument(),eligibility:{eligible:true,orientation:"YES",quality:{turnover_usd_60m:200,trades_60m:10,spread_bps:100,top1_depth_usd:100}}}]);
  assert.equal(validateFrozenCryptoStructSelection(chosen,{spec:s,instrument:instrument()}).valid,true);
  assert.equal(validateFrozenCryptoStructSelection(chosen,{spec:s,instrument:instrument({instrument_id:"different"})}).reason,"frozen_instrument_changed");
  const changed=spec({criteria_hash:sha256Hex("changed")});
  assert.equal(validateFrozenCryptoStructSelection(chosen,{spec:changed,instrument:instrument()}).reason,"independent_criteria_changed");
});

test("duplicate spec, correlated cluster, and semantic alias are deterministically excluded", () => {
  const a=spec();
  const b=spec({event_id:"weather-alt",criteria_hash:sha256Hex("alt")});
  const c=spec({event_id:"weather-other",criteria_hash:sha256Hex("other")});
  const result=deduplicateEventCandidates([
    {spec:a,event_cluster_id:"cluster-a",semantic_alias_key:"weather-90"},
    {spec:a,event_cluster_id:"cluster-b",semantic_alias_key:"duplicate-spec"},
    {spec:b,event_cluster_id:"cluster-a",semantic_alias_key:"different-alias"},
    {spec:c,event_cluster_id:"cluster-c",semantic_alias_key:"weather-90"},
  ]);
  assert.equal(result.accepted.length,1);
  assert.deepEqual(result.rejected.map(x=>x.reason).sort(),["correlated_event_cluster","duplicate_independent_event_spec","semantic_alias_duplicate"].sort());
});

test("independent resolution accepts official authority evidence and forbids price-based resolution", () => {
  const s=spec();
  const pending=createResolutionState(s);
  const resolved=applyIndependentResolution(pending,s,{
    status:"resolved",source_basis:"official_authority",authority:s.resolution_authority,
    reference:s.resolution_reference,outcome:"YES",retrieved_at_utc:"2026-10-02T12:00:00.000Z",
    evidence_hash:sha256Hex("official report")
  });
  assert.equal(resolved.state,"resolved");
  assert.equal(resolved.outcome,"YES");
  const prohibited=applyIndependentResolution(pending,s,{status:"resolved",source_basis:"cryptostruct_price"});
  assert.equal(prohibited.state,"invalid");
  assert.equal(prohibited.reason,"price_based_resolution_prohibited");
});

test("ambiguous, unavailable, disputed, or authority-mismatched resolution becomes invalid/not scored", () => {
  const s=spec();
  for (const reason of ["unavailable","ambiguous","disputed","criteria_changed"]) {
    const result=applyIndependentResolution(createResolutionState(s),s,{status:"invalid",reason});
    assert.equal(result.state,"invalid");
    assert.equal(result.reason,reason);
  }
  const mismatch=applyIndependentResolution(createResolutionState(s),s,{
    status:"resolved",source_basis:"official_authority",authority:"Different Authority",reference:s.resolution_reference,
    outcome:"NO",retrieved_at_utc:"2026-10-02T12:00:00.000Z",evidence_hash:sha256Hex("report")
  });
  assert.equal(mismatch.reason,"resolution_authority_mismatch");
});

test("free-tier withdrawal, auth, premium, purchase, and license changes fail closed to owner gate", () => {
  for (const code of ["SOURCE_UNAVAILABLE","TOOL_REMOVED","TOOL_SCHEMA_CHANGED","REQUIRED_FIELDS_MISSING","AUTH_REQUIRED","PREMIUM_REQUIRED","PURCHASE_REQUIRED","LICENSE_CHANGED"]) {
    const result=classifyCryptoStructAccessFailure(code);
    assert.equal(result.fail_closed,true);
    assert.equal(result.state,"PAUSE");
    assert.equal(result.owner_gate,true);
  }
  const rate=classifyCryptoStructAccessFailure("RATE_LIMITED",{rateLimitPastCutoff:true});
  assert.equal(rate.state,"PAUSE");
});

test("rate limit on the primary cutoff is ineligible and never substitutes a later scored observation", () => {
  const result=classifyCryptoStructAccessFailure("RATE_LIMITED",{rateLimitPastCutoff:false});
  assert.deepEqual(result,{fail_closed:true,state:"INELIGIBLE",reason:"rate_limited_primary_observation",owner_gate:false});
});

test("private evidence reuses EvidenceEvent hash chain and remains deterministic", () => {
  const first=buildPrivateCryptoStructEvidenceEvent({sequence:0,prev_record_hash:null,payload:privatePayload(),recorded_at_utc:CUTOFF});
  const second=buildPrivateCryptoStructEvidenceEvent({sequence:1,prev_record_hash:first.record_hash,payload:privatePayload({eligibility:false,rejection_reason:"low_trades_60m",trades_60m:1}),recorded_at_utc:"2026-09-30T21:00:00.100Z"});
  assert.equal(first.record_hash,computeEvidenceRecordHash(first));
  assert.equal(validateLedgerRecords([first,second]).valid,true);
});

test("sanitized public evidence excludes per-market prices, IDs, and raw/reconstructive data", () => {
  const event=buildPrivateCryptoStructEvidenceEvent({sequence:0,prev_record_hash:null,payload:privatePayload(),recorded_at_utc:CUTOFF});
  const publicEvidence=buildSanitizedPublicEvidence([event],{qualification:"BLOCKED",source_contract_hash:sha256Hex("source contract")});
  assert.equal(publicEvidence.sample_records,1);
  assert.equal(publicEvidence.eligible_records,1);
  assert.equal(publicEvidence.category_counts.WEATHER_CLIMATE,1);
  assert.equal(publicEvidence.raw_responses_retained,false);
  assert.equal(publicEvidence.reconstructive_dataset_retained,false);
  assert.doesNotThrow(()=>assertPublicEvidenceSanitized(publicEvidence));
  const serialized=JSON.stringify(publicEvidence);
  for (const forbidden of ["pm-weather-yes-001","last_price","p_control","turnover_usd_60m","spread_bps","top1_depth_usd"]) assert.equal(serialized.includes(forbidden),false);
});

test("throughput estimator preserves >=100 event and >=300 paired-decision floors", () => {
  const plausible=estimateCohortThroughput({candidate_events:50,eligible_unique_events:40,eligible_cutoff_decisions:110});
  assert.equal(plausible.projected_unique_resolved_events,120);
  assert.equal(plausible.projected_paired_eligible_decisions,330);
  assert.equal(plausible.classification,"PLAUSIBLE");
  assert.equal(plausible.required_unique_resolved_events,COHORT_FLOORS.min_unique_resolved_events);
  assert.equal(plausible.required_paired_eligible_decisions,COHORT_FLOORS.min_paired_eligible_decisions);
  const insufficient=estimateCohortThroughput({candidate_events:50,eligible_unique_events:20,eligible_cutoff_decisions:60});
  assert.equal(insufficient.classification,"DATA_INSUFFICIENT");
});
