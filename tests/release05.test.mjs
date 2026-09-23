import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  COHORT_FLOORS,
  CRYPTOSTRUCT_ALLOWED_TOOLS,
  CRYPTOSTRUCT_MCP_ENDPOINT,
  CRYPTOSTRUCT_REJECTION_REASON_CODES,
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
  createSourceMappingRecord,
  cryptoStructMcpContract,
  cryptoStructSourceContractHash,
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
  sourceMappingRecordHash,
  sourceSchemaFingerprint,
  treatmentContextFromIndependentSpec,
  validateCutoffTiming,
  validateFrozenCryptoStructSelection,
  validateIndependentEventSpec,
  validatePolymarketBinaryOrientation,
  validateSourceMappingForSpec,
  validateSourceMappingRecord,
} from "../src/cryptostruct-source.mjs";
import { sha256Hex } from "../src/canonical.mjs";
import { computeEvidenceRecordHash, validateLedgerRecords } from "../src/ledger.mjs";

const FIXTURES = new URL("./fixtures/", import.meta.url);
const DEADLINE = "2026-10-01T21:00:00.000Z";
const CUTOFF = "2026-09-30T21:00:00.000Z";
const INSTRUMENT_ID = "1001001";
const INSTRUMENT_CODE = "weather-demo-yes-001";

async function fixture(name) {
  return JSON.parse(await readFile(new URL(name, FIXTURES), "utf8"));
}

async function parsedFixture(name, tool, parser) {
  return parser(parseMcpToolEnvelope(await fixture(name), tool));
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
    instrument_id: INSTRUMENT_ID,
    code: INSTRUMENT_CODE,
    instrument_class: "prediction",
    venue: "polymarket",
    venue_name: "Polymarket",
    base: "POLYMARKET_BET",
    quote: "pUSD",
    state: "open",
    days_with_data: 14,
    first_day: "2026-09-09",
    last_day: "2026-09-22",
    total_bytes_compressed: 2749460,
    listed_since: "2026-09-09",
    orientation: "YES",
    price_semantics: "probability_0_1",
    source_schema_fingerprint: sha256Hex("instrument schema"),
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  return {
    instrument_id: INSTRUMENT_ID,
    code: INSTRUMENT_CODE,
    venue: "polymarket",
    captured_at_utc: "2026-09-30T21:00:00.020Z",
    p_control: 0.61,
    trades_60m: 8,
    turnover_usd_60m: 240.5,
    spread_bps_60m_avg: 500,
    top1_depth_bid_usd_60m: 75,
    top1_depth_ask_usd_60m: 110,
    top1_depth_min_side_usd_60m: 75,
    source_schema_fingerprint: sha256Hex("snapshot schema"),
    ...overrides,
  };
}

function mapping(overrides = {}) {
  const s = spec();
  return createSourceMappingRecord({
    independent_event_spec_hash: independentEventSpecHash(s),
    cryptostruct_instrument_id: INSTRUMENT_ID,
    cryptostruct_code: INSTRUMENT_CODE,
    venue: "polymarket",
    type: "prediction",
    mapping_review_timestamp: "2026-09-30T20:00:00.000Z",
    mapping_evidence_hash: sha256Hex("verified semantic mapping evidence"),
    mapping_status: "VERIFIED",
    ...overrides,
  });
}

function qualityArgs(overrides = {}) {
  const s = spec();
  const m = mapping();
  return {
    spec: s,
    frozen_spec_hash: independentEventSpecHash(s),
    frozen_instrument_id: INSTRUMENT_ID,
    frozen_instrument_code: INSTRUMENT_CODE,
    instrument: instrument(),
    snapshot: snapshot(),
    source_mapping_record: m,
    frozen_source_mapping_record_hash: sourceMappingRecordHash(m),
    source_contract_hash: cryptoStructSourceContractHash(),
    cutoff_utc: CUTOFF,
    request_start_utc: CUTOFF,
    request_complete_utc: "2026-09-30T21:00:00.050Z",
    ...overrides,
  };
}

function privatePayload(overrides = {}) {
  const s = spec();
  const m = mapping();
  const ctx = treatmentContextFromIndependentSpec(s, CUTOFF);
  return {
    schema_version: "cryptostruct-private-evidence.v1",
    independent_event_id: s.event_id,
    independent_event_spec_hash: independentEventSpecHash(s),
    source_mapping_record_hash: sourceMappingRecordHash(m),
    cryptostruct_instrument_id: INSTRUMENT_ID,
    cryptostruct_code: INSTRUMENT_CODE,
    underlying_venue: CRYPTOSTRUCT_UNDERLYING_VENUE,
    orientation: "YES",
    category: s.category,
    source_endpoint: CRYPTOSTRUCT_MCP_ENDPOINT,
    source_tool: "get_market_snapshot",
    source_schema_fingerprint: sha256Hex("snapshot schema"),
    source_contract_hash: cryptoStructSourceContractHash(),
    scheduled_cutoff_utc: CUTOFF,
    request_start_utc: CUTOFF,
    request_complete_utc: "2026-09-30T21:00:00.050Z",
    capture_timestamp_utc: "2026-09-30T21:00:00.020Z",
    p_control: 0.61,
    trades_60m: 8,
    turnover_usd_60m: 240.5,
    spread_bps_60m_avg: 500,
    top1_depth_bid_usd_60m: 75,
    top1_depth_ask_usd_60m: 110,
    top1_depth_min_side_usd_60m: 75,
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

test("Release 0.5.1 contract remains keyless and offline-gated", () => {
  const contract = cryptoStructMcpContract();
  assert.equal(contract.endpoint, CRYPTOSTRUCT_MCP_ENDPOINT);
  assert.equal(contract.free_tier, "keyless");
  assert.equal(contract.operational_access_authorized, false);
  assert.deepEqual(contract.allowed_tools, CRYPTOSTRUCT_ALLOWED_TOOLS);
  assert.match(contract.source_contract_hash, /^[a-f0-9]{64}$/u);
  assert.equal(contract.documented_units.spread, "basis points");
});

test("source adapter still refuses operational access without a separately authorized caller", async () => {
  const adapter = createCryptoStructSourceAdapter({ invokeTool: async () => ({}) });
  await assert.rejects(() => adapter.searchInstruments({ q: "weather" }), /OWNER_LICENSE_ACCEPTANCE_REQUIRED/u);
  await assert.rejects(() => adapter.getInstrument({ instrument_id: 1001001 }), /OWNER_LICENSE_ACCEPTANCE_REQUIRED/u);
  await assert.rejects(() => adapter.getMarketSnapshot({ instrument_id: 1001001 }), /OWNER_LICENSE_ACCEPTANCE_REQUIRED/u);
});

test("exact JSON-RPC result.content text envelope and observed search payload normalize deterministically", async () => {
  const raw = await fixture("cryptostruct-search-instruments.synthetic.json");
  const search = parseSearchInstrumentsResult(parseMcpToolEnvelope(raw, "search_instruments"));
  assert.equal(raw.jsonrpc, "2.0");
  assert.equal(raw.result.content[0].type, "text");
  assert.equal(search.total_matching, 2);
  assert.equal(search.showing, 2);
  assert.equal(search.instruments[0].instrument_id, INSTRUMENT_ID);
  assert.equal(search.instruments[0].instrument_class, "prediction");
  assert.equal("question" in search.instruments[0], false);
  assert.equal("category" in search.instruments[0], false);
  assert.match(search.source_schema_fingerprint, /^[a-f0-9]{64}$/u);
});

test("old structuredContent-only wire assumption is rejected", () => {
  assert.throws(() => parseMcpToolEnvelope({ structuredContent: { hits: [] } }, "search_instruments"));
});

test("get_instrument observed schema normalizes type and provider-level probability semantics", async () => {
  const master = await parsedFixture("cryptostruct-get-instrument.synthetic.json", "get_instrument", parseGetInstrumentResult);
  assert.equal(master.instrument_id, INSTRUMENT_ID);
  assert.equal(master.instrument_class, "prediction");
  assert.equal(master.venue, "polymarket");
  assert.equal(master.state, "open");
  assert.equal(master.orientation, "YES");
  assert.equal(master.price_semantics, "probability_0_1");
  assert.equal("close_time_utc" in master, false);
  assert.equal("provenance" in master, false);
});

test("get_market_snapshot maps price_last and nested 60m fields exactly", async () => {
  const snap = await parsedFixture("cryptostruct-market-snapshot.synthetic.json", "get_market_snapshot", parseGetMarketSnapshotResult);
  assert.equal(snap.p_control, 0.61);
  assert.notEqual(snap.p_control, 0.72);
  assert.equal(snap.trades_60m, 8);
  assert.equal(snap.turnover_usd_60m, 240.5);
  assert.equal(snap.spread_bps_60m_avg, 500);
  assert.equal(snap.top1_depth_bid_usd_60m, 75);
  assert.equal(snap.top1_depth_ask_usd_60m, 110);
  assert.equal(snap.top1_depth_min_side_usd_60m, 75);
});

test("source schema fingerprint is deterministic and source-contract hash is product-frozen", async () => {
  const raw = parseMcpToolEnvelope(await fixture("cryptostruct-market-snapshot.synthetic.json"), "get_market_snapshot");
  assert.equal(sourceSchemaFingerprint(raw), sourceSchemaFingerprint(structuredClone(raw)));
  assert.match(sourceSchemaFingerprint(raw), /^[a-f0-9]{64}$/u);
  assert.equal(cryptoStructMcpContract().source_contract_hash, cryptoStructSourceContractHash());
});

test("malformed or undocumented payload fields fail closed", async () => {
  assert.throws(() => parseMcpToolEnvelope({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "not-json" }] } }, "get_market_snapshot"), /not JSON/u);
  const raw = parseMcpToolEnvelope(await fixture("cryptostruct-market-snapshot.synthetic.json"), "get_market_snapshot");
  assert.throws(() => parseGetMarketSnapshotResult({ ...raw, undocumented: true }), /unknown field/u);
  assert.throws(() => parseGetMarketSnapshotResult({ ...raw, price_last: 2 }), /\[0,1\]/u);
});

test("IndependentEventSpec remains category, deadline, resolution, and schedule authority", () => {
  const s = spec();
  assert.equal(validateIndependentEventSpec(s), s);
  assert.equal(s.category, "WEATHER_CLIMATE");
  assert.equal(s.deadline_utc, DEADLINE);
  assert.deepEqual(plannedCryptoStructCutoffs(s.deadline_utc).map((x) => x.label), ["T-24h", "T-6h", "T-1h"]);
  assert.throws(() => spec({ category: "SPORTS" }), /category not allowed/u);
});

test("search discovery cannot admit a false positive without a VERIFIED SourceMappingRecord", async () => {
  const search = await parsedFixture("cryptostruct-search-instruments.synthetic.json", "search_instruments", parseSearchInstrumentsResult);
  const falsePositive = { ...instrument(), instrument_id: search.instruments[1].instrument_id, code: search.instruments[1].code };
  const result = validateSourceMappingForSpec({ spec: spec(), instrument: falsePositive, mapping_record: null });
  assert.equal(result.valid, false);
  assert.equal(result.reason, "semantic_mapping_unproven");
  assert.equal(spec().category, "WEATHER_CLIMATE");
});

test("SourceMappingRecord is VERIFIED-only and hashable", async () => {
  const m = mapping();
  assert.equal(validateSourceMappingRecord(m), m);
  assert.match(sourceMappingRecordHash(m), /^[a-f0-9]{64}$/u);
  assert.equal(validateSourceMappingForSpec({ spec: spec(), instrument: instrument(), mapping_record: m }).valid, true);
  const wrong = mapping({ cryptostruct_code: "different-code" });
  assert.equal(validateSourceMappingForSpec({ spec: spec(), instrument: instrument(), mapping_record: wrong }).reason, "semantic_mapping_unproven");
  assert.throws(() => createSourceMappingRecord({ ...m, mapping_status: "PENDING" }), /VERIFIED/u);
  const schema = JSON.parse(await readFile(new URL("../schemas/cryptostruct-source-mapping-record.v1.schema.json", import.meta.url), "utf8"));
  assert.equal(schema.properties.mapping_status.const, "VERIFIED");
});

test("provider-level Polymarket prediction semantics normalize to YES probability_0_1 only", () => {
  assert.equal(validatePolymarketBinaryOrientation(instrument()).valid, true);
  assert.equal(validatePolymarketBinaryOrientation(instrument({ venue: "kalshi" })).reason, "wrong_venue");
  assert.equal(validatePolymarketBinaryOrientation(instrument({ instrument_class: "spot" })).reason, "not_binary_prediction");
  assert.equal(validatePolymarketBinaryOrientation(instrument({ orientation: null })).reason, "orientation_ambiguous");
});

test("quality gate uses corrected fields, minimum-side depth, and verified mapping", () => {
  const result = evaluateCryptoStructSourceQuality(qualityArgs());
  assert.equal(result.eligible, true);
  assert.equal(result.p_control, 0.61);
  assert.equal(result.quality.spread_bps_60m_avg, 500);
  assert.equal(result.quality.top1_depth_min_side_usd_60m, 75);
});

test("minimum-side depth requires both bid and ask to meet the 50 USD floor", () => {
  const lowBid = snapshot({ top1_depth_bid_usd_60m: 49, top1_depth_ask_usd_60m: 100, top1_depth_min_side_usd_60m: 49 });
  assert.equal(evaluateCryptoStructSourceQuality(qualityArgs({ snapshot: lowBid })).reason, "low_top1_depth");
  const lowAsk = snapshot({ top1_depth_bid_usd_60m: 100, top1_depth_ask_usd_60m: 0, top1_depth_min_side_usd_60m: 0 });
  assert.equal(evaluateCryptoStructSourceQuality(qualityArgs({ snapshot: lowAsk })).reason, "low_top1_depth");
});

test("quality gate preserves thresholds, open state, provenance, and semantic mapping", () => {
  assert.equal(evaluateCryptoStructSourceQuality(qualityArgs({ snapshot: snapshot({ trades_60m: QUALITY_GATE.min_trades_60m - 1 }) })).reason, "low_trades_60m");
  assert.equal(evaluateCryptoStructSourceQuality(qualityArgs({ snapshot: snapshot({ turnover_usd_60m: QUALITY_GATE.min_turnover_usd_60m - 0.01 }) })).reason, "low_turnover_60m");
  assert.equal(evaluateCryptoStructSourceQuality(qualityArgs({ snapshot: snapshot({ spread_bps_60m_avg: QUALITY_GATE.max_spread_bps_60m_avg + 0.01 }) })).reason, "invalid_or_wide_spread");
  assert.equal(evaluateCryptoStructSourceQuality(qualityArgs({ instrument: instrument({ state: "unlisted" }) })).reason, "event_not_open_or_unresolved");
  assert.equal(evaluateCryptoStructSourceQuality(qualityArgs({ source_mapping_record: null })).reason, "semantic_mapping_unproven");
  assert.equal(evaluateCryptoStructSourceQuality(qualityArgs({ snapshot: snapshot({ source_schema_fingerprint: null }) })).reason, "provenance_missing");
});

test("cutoff timing remains exact start through cutoff plus 60 seconds", () => {
  assert.equal(validateCutoffTiming({ cutoff_utc:CUTOFF, request_start_utc:CUTOFF, request_complete_utc:"2026-09-30T21:00:59.999Z", snapshot_capture_utc:"2026-09-30T21:00:30.000Z" }).valid, true);
  assert.equal(validateCutoffTiming({ cutoff_utc:CUTOFF, request_start_utc:"2026-09-30T21:00:00.001Z", request_complete_utc:"2026-09-30T21:00:01.000Z", snapshot_capture_utc:"2026-09-30T21:00:00.500Z" }).reason, "request_not_started_at_cutoff");
});

test("selector uses turnover, trades, average spread, minimum-side depth, then stable ID", () => {
  const s = spec();
  const mk = (id, q) => ({spec:s,instrument:instrument({instrument_id:id,code:id}),eligibility:{eligible:true,orientation:"YES",source_mapping_record_hash:sha256Hex("mapping-"+id),quality:q}});
  const selected = selectCryptoStructInstrument([
    mk("z",{turnover_usd_60m:200,trades_60m:10,spread_bps_60m_avg:100,top1_depth_min_side_usd_60m:100}),
    mk("b",{turnover_usd_60m:300,trades_60m:9,spread_bps_60m_avg:200,top1_depth_min_side_usd_60m:90}),
    mk("a",{turnover_usd_60m:300,trades_60m:9,spread_bps_60m_avg:200,top1_depth_min_side_usd_60m:90}),
  ]);
  assert.equal(selected.instrument_id,"a");
});

test("frozen selection enforces stable ID/code, criteria, deadline, and mapping hash", () => {
  const s=spec(); const i=instrument(); const m=mapping();
  const chosen=selectCryptoStructInstrument([{spec:s,instrument:i,source_mapping_record:m,eligibility:evaluateCryptoStructSourceQuality(qualityArgs())}]);
  assert.equal(validateFrozenCryptoStructSelection(chosen,{spec:s,instrument:i,source_mapping_record:m}).valid,true);
  assert.equal(validateFrozenCryptoStructSelection(chosen,{spec:s,instrument:instrument({instrument_id:"different"}),source_mapping_record:m}).reason,"frozen_instrument_changed");
  assert.equal(validateFrozenCryptoStructSelection(chosen,{spec:s,instrument:instrument({code:"different"}),source_mapping_record:m}).reason,"frozen_instrument_code_changed");
});

test("duplicate/correlation controls remain deterministic", () => {
  const a=spec(); const b=spec({event_id:"weather-alt",criteria_hash:sha256Hex("alt")}); const c=spec({event_id:"weather-other",criteria_hash:sha256Hex("other")});
  const result=deduplicateEventCandidates([{spec:a,event_cluster_id:"cluster-a",semantic_alias_key:"weather-90"},{spec:a,event_cluster_id:"cluster-b",semantic_alias_key:"duplicate-spec"},{spec:b,event_cluster_id:"cluster-a",semantic_alias_key:"different-alias"},{spec:c,event_cluster_id:"cluster-c",semantic_alias_key:"weather-90"}]);
  assert.equal(result.accepted.length,1);
  assert.deepEqual(result.rejected.map((x)=>x.reason).sort(),["correlated_event_cluster","duplicate_independent_event_spec","semantic_alias_duplicate"].sort());
});

test("independent resolution remains frozen and forbids price resolution", () => {
  const s=spec(); const pending=createResolutionState(s);
  const evidence={status:"resolved",source_basis:"official_authority",authority:s.resolution_authority,reference:s.resolution_reference,outcome:"YES",retrieved_at_utc:"2026-10-02T12:00:00.000Z",evidence_hash:sha256Hex("official report")};
  assert.equal(applyIndependentResolution(pending,s,evidence).state,"resolved");
  assert.equal(applyIndependentResolution(pending,spec({criteria_hash:sha256Hex("changed")}),evidence).reason,"independent_criteria_changed");
  assert.equal(applyIndependentResolution(pending,s,{status:"resolved",source_basis:"cryptostruct_price"}).reason,"price_based_resolution_prohibited");
});

test("free-tier withdrawal and rate limits remain fail closed", () => {
  for (const code of ["SOURCE_UNAVAILABLE","TOOL_REMOVED","TOOL_SCHEMA_CHANGED","REQUIRED_FIELDS_MISSING","AUTH_REQUIRED","PREMIUM_REQUIRED","PURCHASE_REQUIRED","LICENSE_CHANGED"]) {
    assert.equal(classifyCryptoStructAccessFailure(code).state,"PAUSE");
  }
  assert.equal(classifyCryptoStructAccessFailure("RATE_LIMITED",{rateLimitPastCutoff:false}).reason,"rate_limited_primary_observation");
});

test("private evidence carries corrected provenance and explicit depth semantics in one hash chain", () => {
  const first=buildPrivateCryptoStructEvidenceEvent({run_id:"release051-proof",sequence:0,prev_record_hash:null,payload:privatePayload(),recorded_at_utc:CUTOFF});
  const second=buildPrivateCryptoStructEvidenceEvent({run_id:"release051-proof",sequence:1,prev_record_hash:first.record_hash,payload:privatePayload({independent_event_id:"science-event-b",independent_event_spec_hash:sha256Hex("event-b"),category:"SCIENCE_TECHNOLOGY",eligibility:false,rejection_reason:"low_trades_60m",trades_60m:1}),recorded_at_utc:"2026-09-30T21:00:00.100Z"});
  assert.equal(validateLedgerRecords([first,second]).valid,true);
  assert.equal(first.record_hash,computeEvidenceRecordHash(first));
  assert.equal(first.payload.source_endpoint,CRYPTOSTRUCT_MCP_ENDPOINT);
  assert.equal("source_version" in first.payload,false);
  assert.equal("spread_bps" in first.payload,false);
});

test("private evidence rejects wrong min-side derivation and free-form rejection text", () => {
  assert.throws(() => buildPrivateCryptoStructEvidenceEvent({run_id:"x",sequence:0,prev_record_hash:null,payload:privatePayload({top1_depth_min_side_usd_60m:110}),recorded_at_utc:CUTOFF}), /min\(bid,ask\)/u);
  assert.throws(() => buildPrivateCryptoStructEvidenceEvent({run_id:"x",sequence:0,prev_record_hash:null,payload:privatePayload({eligibility:false,rejection_reason:"provider raw error text"}),recorded_at_utc:CUTOFF}), /canonical Release 0.5 reason code/u);
  assert.ok(CRYPTOSTRUCT_REJECTION_REASON_CODES.includes("semantic_mapping_unproven"));
});

test("private/public/mapping schemas match runtime correction semantics", async () => {
  const privateSchema=JSON.parse(await readFile(new URL("../schemas/cryptostruct-private-evidence.v1.schema.json",import.meta.url),"utf8"));
  const publicSchema=JSON.parse(await readFile(new URL("../schemas/cryptostruct-public-evidence.v1.schema.json",import.meta.url),"utf8"));
  const mappingSchema=JSON.parse(await readFile(new URL("../schemas/cryptostruct-source-mapping-record.v1.schema.json",import.meta.url),"utf8"));
  assert.deepEqual(privateSchema.properties.rejection_reason.enum,[...CRYPTOSTRUCT_REJECTION_REASON_CODES,null]);
  assert.deepEqual(publicSchema.properties.rejection_reasons.propertyNames.enum,CRYPTOSTRUCT_REJECTION_REASON_CODES);
  assert.equal(mappingSchema.properties.mapping_status.const,"VERIFIED");
  assert.equal(privateSchema.properties.spread_bps,undefined);
  assert.equal(privateSchema.properties.top1_depth_usd,undefined);
  assert.equal(privateSchema.properties.source_version,undefined);
});

test("sanitized public evidence remains aggregate and non-reconstructive", () => {
  const event=buildPrivateCryptoStructEvidenceEvent({run_id:"release051-public",sequence:0,prev_record_hash:null,payload:privatePayload(),recorded_at_utc:CUTOFF});
  const publicEvidence=buildSanitizedPublicEvidence([event],{qualification:"BLOCKED",source_contract_hash:cryptoStructSourceContractHash(),source_schema_fingerprint:snapshot().source_schema_fingerprint});
  assert.equal(publicEvidence.sample_records,1);
  assert.match(publicEvidence.source_schema_fingerprint,/^[a-f0-9]{64}$/u);
  assert.equal(publicEvidence.raw_responses_retained,false);
  assert.doesNotThrow(()=>assertPublicEvidenceSanitized(publicEvidence));
  const serialized=JSON.stringify(publicEvidence);
  for (const forbidden of [INSTRUMENT_ID,INSTRUMENT_CODE,"p_control","spread_bps_60m_avg","top1_depth_bid_usd_60m"]) assert.equal(serialized.includes(forbidden),false);
});

test("throughput estimator preserves >=100 events and >=300 paired decisions", () => {
  const plausible=estimateCohortThroughput({candidate_events:50,eligible_unique_events:40,eligible_cutoff_decisions:110});
  assert.equal(plausible.projected_unique_resolved_events,120);
  assert.equal(plausible.projected_paired_eligible_decisions,330);
  assert.equal(plausible.classification,"PLAUSIBLE");
  assert.equal(estimateCohortThroughput({candidate_events:50,eligible_unique_events:20,eligible_cutoff_decisions:60}).classification,"DATA_INSUFFICIENT");
  assert.equal(plausible.required_unique_resolved_events,COHORT_FLOORS.min_unique_resolved_events);
});
