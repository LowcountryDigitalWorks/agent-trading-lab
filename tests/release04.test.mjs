import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { canonicalSerialize, sha256Hex } from "../src/canonical.mjs";
import {
  KALSHI_API_BASE,
  OOS_MIN_PAIRED_DECISIONS,
  OOS_MIN_RESOLVED_EVENTS,
  addCohortEvent,
  applySingleRedesign,
  brierLoss,
  buildPhase0bEvidence,
  calibrationReliability,
  categoryDiagnostics,
  cohortFloors,
  createCohortState,
  createForecastCandidate,
  createOosBState,
  deriveKalshiBaseline,
  evaluateFuturePassGate,
  evaluateProbabilityStability,
  evaluateSourceEligibility,
  eventClusterBootstrap,
  finalizeCohort,
  forecastMetrics,
  logLoss,
  marketRulesHash,
  outlierRemovalDiagnostics,
  parseMockTreatment,
  plannedObservationCutoffs,
  probabilityBand,
  recordResolvedEvent,
  regimeDiagnostics,
  selectEventMarket,
  selectStabilitySubset,
  treatmentProbabilityForScoring,
  validateFrozenMarket,
} from "../src/phase0b.mjs";
import {
  RELEASE04_MAX_CANDIDATE_EVENTS,
  RELEASE04_MAX_GETS,
  createKalshiPublicClient,
  runKalshiSourceQualification,
} from "../src/kalshi-public.mjs";

const CLOSE = "2026-10-10T18:00:00.000Z";
const CUTOFF = "2026-10-09T18:00:00.000Z";

function event(overrides = {}) {
  return {
    event_ticker: "KX-WEATHER-TEST",
    series_ticker: "KX-WEATHER",
    title: "Weather test event",
    sub_title: "Synthetic fixture",
    category: "Weather",
    settlement_sources: [{ name: "Official weather service", url: "https://example.invalid" }],
    ...overrides,
  };
}
function market(overrides = {}) {
  return {
    ticker: "KX-WEATHER-TEST-A",
    event_ticker: "KX-WEATHER-TEST",
    market_type: "binary",
    status: "open",
    paused: false,
    halted: false,
    close_time: CLOSE,
    rules_primary: "Synthetic rules",
    rules_secondary: "",
    ...overrides,
  };
}
function book({ yes = [["0.40","10"]], no = [["0.54","8"]] } = {}) {
  return { orderbook_fp: { yes_dollars: yes, no_dollars: no } };
}
function eligible(overrides = {}) {
  return evaluateSourceEligibility({
    event: event(),
    market: market(overrides.market),
    orderbook: overrides.orderbook ?? book(),
    cutoff_utc: CUTOFF,
    request_start_utc: CUTOFF,
    request_complete_utc: "2026-10-09T18:00:30.000Z",
    enforce_cutoff: overrides.enforce_cutoff ?? true,
  });
}
function scoredRows({ events = 4, perEvent = 3, treatmentShift = 0.08, failEvery = 0 } = {}) {
  const rows = [];
  for (let e = 0; e < events; e += 1) {
    const outcome = e % 2;
    for (let d = 0; d < perEvent; d += 1) {
      const pControl = outcome ? 0.58 : 0.42;
      const pTreatment = outcome ? pControl + treatmentShift : pControl - treatmentShift;
      rows.push({
        candidate_id: `E${e}:D${d}`,
        event_id: `E${e}`,
        category: ["Weather","Science","Technology"][e % 3],
        p_control: pControl,
        p_treatment: pTreatment,
        outcome,
        treatment_status: failEvery && rows.length % failEvery === 0 ? "timeout" : "ok",
      });
    }
  }
  return rows;
}

test("Kalshi reciprocal ask, midpoint, spread and fixed-point top size are deterministic", async () => {
  const fixture = JSON.parse(await readFile(new URL("./fixtures/phase0b-kalshi-orderbook.json", import.meta.url), "utf8"));
  const result = deriveKalshiBaseline(fixture);
  assert.equal(result.eligible, true);
  assert.equal(result.best_yes_bid, 0.42);
  assert.equal(result.best_no_bid, 0.54);
  assert.equal(result.best_yes_ask, 0.46);
  assert.equal(result.yes_spread, 0.04);
  assert.equal(result.p_control, 0.44);
  assert.equal(result.combined_top_bid_size, 8);
});

test("baseline fails closed for empty side, crossed book, wide spread, and malformed data", () => {
  assert.throws(() => deriveKalshiBaseline(book({ yes: [] })), /missing or empty/u);
  assert.equal(deriveKalshiBaseline(book({ yes: [["0.70","1"]], no: [["0.40","1"]] })).reason, "crossed_book");
  assert.equal(deriveKalshiBaseline(book({ yes: [["0.20","1"]], no: [["0.60","1"]] })).reason, "wide_spread");
  assert.throws(() => deriveKalshiBaseline({ orderbook_fp: { yes_dollars: [["x","1"]], no_dollars: [["0.5","1"]] } }), /fixed-point/u);
});

test("source eligibility rejects closed, paused, missing metadata, and stale cutoff timing", () => {
  assert.equal(evaluateSourceEligibility({ event:event(), market:market({status:"closed"}), orderbook:book(), enforce_cutoff:false }).reason, "market_not_open");
  assert.equal(evaluateSourceEligibility({ event:event(), market:market({paused:true}), orderbook:book(), enforce_cutoff:false }).reason, "market_paused_or_halted");
  assert.equal(evaluateSourceEligibility({ event:event(), market:market({rules_primary:""}), orderbook:book(), enforce_cutoff:false }).reason, "rules_unavailable");
  assert.equal(evaluateSourceEligibility({ event:event({settlement_sources:[]}), market:market(), orderbook:book(), enforce_cutoff:false }).reason, "resolution_metadata_unavailable");
  assert.equal(evaluateSourceEligibility({
    event:event(), market:market(), orderbook:book(), cutoff_utc:CUTOFF,
    request_start_utc:CUTOFF, request_complete_utc:"2026-10-09T18:01:01.000Z",
  }).reason, "stale_or_invalid_response_timing");
});

test("market selector is deterministic by spread, then top bid size, then ticker", () => {
  const e = event();
  const a = { event:e, market:market({ticker:"B"}), eligibility:evaluateSourceEligibility({event:e,market:market({ticker:"B"}),orderbook:book({yes:[["0.40","10"]],no:[["0.55","10"]]}),enforce_cutoff:false}) };
  const b = { event:e, market:market({ticker:"A"}), eligibility:evaluateSourceEligibility({event:e,market:market({ticker:"A"}),orderbook:book({yes:[["0.40","20"]],no:[["0.55","20"]]}),enforce_cutoff:false}) };
  assert.equal(selectEventMarket([a,b]).selected_ticker, "A");
  const c = { event:e, market:market({ticker:"C"}), eligibility:evaluateSourceEligibility({event:e,market:market({ticker:"C"}),orderbook:book({yes:[["0.42","1"]],no:[["0.54","1"]]}),enforce_cutoff:false}) };
  assert.equal(selectEventMarket([a,c]).selected_ticker, "C");
  const tieA = { event:e, market:market({ticker:"A"}), eligibility:a.eligibility };
  assert.equal(selectEventMarket([a,tieA]).selected_ticker, "A");
});

test("frozen ticker, close time, and rules changes invalidate the event", () => {
  const e=event();
  const m=market();
  const selection={event_id:e.event_ticker,selected_ticker:m.ticker,frozen_close_time_utc:m.close_time,frozen_rules_hash:marketRulesHash(m,e)};
  assert.equal(validateFrozenMarket(selection,{event:e,market:m}).valid,true);
  assert.equal(validateFrozenMarket(selection,{event:e,market:{...m,close_time:"2026-10-10T19:00:00.000Z"}}).reason,"close_time_changed");
  assert.equal(validateFrozenMarket(selection,{event:e,market:{...m,rules_primary:"changed"}}).reason,"resolution_criteria_changed");
});

test("planned cutoffs are exactly T-24h, T-6h, and T-1h", () => {
  const values=plannedObservationCutoffs(CLOSE);
  assert.deepEqual(values.map((x)=>x.label),["T-24h","T-6h","T-1h"]);
  assert.deepEqual(values.map((x)=>x.cutoff_utc),[
    "2026-10-09T18:00:00.000Z","2026-10-10T12:00:00.000Z","2026-10-10T17:00:00.000Z",
  ]);
});

test("Phase 0B forecast CandidateEnvelope reuses v1 and preserves baseline provenance", () => {
  const e=event(), m=market();
  const el=eligible({enforce_cutoff:false});
  const selection={event_id:e.event_ticker,selected_ticker:m.ticker,frozen_close_time_utc:m.close_time,frozen_rules_hash:marketRulesHash(m,e)};
  const candidate=createForecastCandidate({
    event:e,market:m,selection,eligibility:el,cutoff_utc:CUTOFF,
    request_start_utc:CUTOFF,request_complete_utc:"2026-10-09T18:00:10.000Z",category:"Weather",
  });
  assert.equal(candidate.schema_version,"candidate-envelope.v1");
  assert.equal(candidate.track,"0B");
  assert.equal(candidate.market_state.p_control,el.baseline.p_control);
  assert.match(candidate.state_hash,/^[a-f0-9]{64}$/u);
});

test("mock treatment validates structured p_yes and keeps failure candidates paired through control fallback", () => {
  const inputHash=sha256Hex("input");
  const ok=parseMockTreatment({candidate_id:"c1",input_hash:inputHash,output:'{"p_yes":0.61}'});
  assert.equal(ok.status,"ok");
  assert.equal(ok.p_yes,0.61);
  for (const status of ["timeout","unavailable"]) {
    const failed=parseMockTreatment({candidate_id:`c-${status}`,input_hash:inputHash,status});
    assert.equal(failed.action,"SKIP");
    assert.equal(treatmentProbabilityForScoring(failed,0.44),0.44);
  }
  const invalid=parseMockTreatment({candidate_id:"bad",input_hash:inputHash,output:'{"p_yes":2}'});
  assert.equal(invalid.status,"invalid");
  assert.equal(treatmentProbabilityForScoring(invalid,0.44),0.44);
});

test("Brier, paired improvement, BSS, log loss, calibration, and treatment failure rate are deterministic", () => {
  const rows=[
    {candidate_id:"a",event_id:"e1",category:"Weather",p_control:.6,p_treatment:.8,outcome:1,treatment_status:"ok"},
    {candidate_id:"b",event_id:"e2",category:"Science",p_control:.6,p_treatment:.3,outcome:0,treatment_status:"timeout"},
  ];
  const m=forecastMetrics(rows);
  assert.equal(m.control_brier,.26);
  assert.ok(Math.abs(m.treatment_brier-.065)<1e-12);
  assert.ok(Math.abs(m.paired_brier_improvement-.195)<1e-12);
  assert.ok(Math.abs(m.brier_skill_score-.75)<1e-12);
  assert.equal(m.treatment_failure_rate,.5);
  assert.ok(Number.isFinite(logLoss(0,0)));
  assert.equal(brierLoss(.8,1),.03999999999999998);
  const cal=calibrationReliability(rows,{bins:5});
  assert.equal(cal.reduce((s,x)=>s+x.count,0),2);
});

test("p_control regime boundaries are LOW, MID, and HIGH", () => {
  assert.equal(probabilityBand(.249),"LOW");
  assert.equal(probabilityBand(.25),"MID");
  assert.equal(probabilityBand(.75),"MID");
  assert.equal(probabilityBand(.751),"HIGH");
});

test("event-cluster bootstrap is reproducible with frozen clusters", () => {
  const rows=scoredRows({events:8,perEvent:3});
  const a=eventClusterBootstrap(rows,{resamples:200,seed:123});
  const b=eventClusterBootstrap(rows,{resamples:200,seed:123});
  assert.deepEqual(a,b);
  assert.ok(a.lower_95<=a.upper_95);
});

test("category and regime diagnostics expose adequacy without fabricating it", () => {
  const rows=scoredRows({events:9,perEvent:3});
  const categories=categoryDiagnostics(rows,{bootstrapResamples:50,seed:2});
  assert.equal(Object.values(categories).every((x)=>x.adequate===false),true);
  const regimes=regimeDiagnostics(rows);
  assert.equal(Object.values(regimes).every((x)=>x.adequate===false),true);
});

test("event-level outlier falsification removes top 1, top 2, and top 3 positive contributors", () => {
  const out=outlierRemovalDiagnostics(scoredRows({events:6,perEvent:3}));
  assert.ok(Object.hasOwn(out,"remove_top_1"));
  assert.ok(Object.hasOwn(out,"remove_top_2"));
  assert.ok(Object.hasOwn(out,"remove_top_3"));
});

test("10 percent stability selection is deterministic by category and p_control band and triplet gate is enforced", () => {
  const rows=Array.from({length:30},(_,i)=>({
    candidate_id:`c${String(i).padStart(2,"0")}`,event_id:`e${i}`,
    category:i%2?"Weather":"Science",p_control:i%3===0?.2:i%3===1?.5:.8,p_treatment:.5,outcome:i%2,treatment_status:"ok",
  }));
  const first=selectStabilitySubset(rows), second=selectStabilitySubset(rows);
  assert.deepEqual(first.map((x)=>x.candidate_id),second.map((x)=>x.candidate_id));
  assert.ok(first.length>0 && first.length<rows.length);
  assert.equal(evaluateProbabilityStability(Array.from({length:10},()=>[.50,.52,.49])).pass,true);
  assert.equal(evaluateProbabilityStability([[.2,.3,.4],[.1,.3,.5],...Array.from({length:8},()=>[.5,.51,.5])]).pass,false);
});

test("OOS-A floors, exactly one redesign, and OOS-B event reuse prohibition are deterministic", () => {
  const a=createCohortState("OOS-A");
  for(let i=0;i<OOS_MIN_RESOLVED_EVENTS;i+=1){
    const id=`A${i}`; addCohortEvent(a,id); recordResolvedEvent(a,id,3);
  }
  assert.equal(cohortFloors(a).paired_eligible_decisions,OOS_MIN_PAIRED_DECISIONS);
  finalizeCohort(a,{treatmentQualityPass:false});
  assert.equal(a.state,"fail_treatment_quality");
  applySingleRedesign(a,"v2");
  assert.equal(a.state,"redesign_frozen");
  assert.throws(()=>applySingleRedesign(a,"v3"),/requires OOS-A treatment-quality failure|exactly one/u);
  const b=createOosBState(a);
  assert.throws(()=>addCohortEvent(b,"A0"),/reuse/u);
});

test("data insufficient is not redesign authority and OOS-B treatment failure is final", () => {
  const a=createCohortState("OOS-A"); addCohortEvent(a,"A1"); recordResolvedEvent(a,"A1",3);
  finalizeCohort(a,{treatmentQualityPass:false}); assert.equal(a.state,"data_insufficient");
  assert.throws(()=>applySingleRedesign(a,"v2"),/requires OOS-A treatment-quality failure/u);
  const passed=createCohortState("OOS-A"); passed.state="pass"; passed.selected_event_ids=["A1"];
  const b=createOosBState(passed);
  for(let i=0;i<OOS_MIN_RESOLVED_EVENTS;i+=1){const id=`B${i}`;addCohortEvent(b,id);recordResolvedEvent(b,id,3);}
  finalizeCohort(b,{treatmentQualityPass:false}); assert.equal(b.state,"final_fail");
});

test("future pass-gate evaluator applies frozen criteria without claiming Release 0.4 passes", () => {
  const rows=scoredRows({events:100,perEvent:3,treatmentShift:.08});
  const bootstrap=eventClusterBootstrap(rows,{resamples:300,seed:7});
  const result=evaluateFuturePassGate({
    observations:rows,bootstrap,leakage_pass:true,provenance_pass:true,stability_pass:true,
    outlier_pass:true,category_pass:true,regime_robustness_pass:true,
  });
  assert.equal(result.evaluable,true);
  assert.equal(result.criteria.sample_floors,true);
  assert.equal(result.pass,true);
  assert.match(result.note,/effect-size floor/u);
});

test("Phase 0B evidence remains deterministic, hash-chained, and tamper-evident", () => {
  const entries=[
    {event_type:"run_started",payload:{release:"0.4"}},
    {event_type:"metric",payload:{paired:3}},
    {event_type:"run_closed",payload:{status:"synthetic"}},
  ];
  const a=buildPhase0bEvidence({runId:"r",recordedAtUtc:CUTOFF,entries});
  const b=buildPhase0bEvidence({runId:"r",recordedAtUtc:CUTOFF,entries});
  assert.equal(a.digest,b.digest);
  assert.equal(a.records[1].prev_record_hash,a.records[0].record_hash);
});

test("public client sends GET without authentication and enforces the 250 ceiling", async () => {
  const calls=[];
  const fetchImpl=async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({events:[]}),{status:200});};
  let clock=Date.parse(CUTOFF);
  const client=createKalshiPublicClient({fetchImpl,maxGets:1,now:()=>clock+=5});
  await client.getJson("/events?limit=1");
  assert.equal(client.count,1);
  assert.equal(calls[0].options.method,"GET");
  assert.deepEqual(calls[0].options.headers,{Accept:"application/json"});
  assert.equal(Object.keys(calls[0].options.headers).some((x)=>/auth|key|signature/i.test(x)),false);
  await assert.rejects(()=>client.getJson("/events?limit=1"),/ceiling/u);
});

test("bounded qualification is aggregate-only, under caps, and BLOCKED while retention terms are unresolved", async () => {
  const e={...event(),markets:[market()]};
  const responses=new Map([
    [`${KALSHI_API_BASE}/events?limit=50&status=open&with_nested_markets=true`,{events:[e],cursor:""}],
    [`${KALSHI_API_BASE}/markets/${market().ticker}/orderbook?depth=1`,book()],
  ]);
  const fetchImpl=async(url)=>responses.has(url)?new Response(JSON.stringify(responses.get(url)),{status:200}):new Response("not found",{status:404});
  let clock=Date.parse(CUTOFF);
  const client=createKalshiPublicClient({fetchImpl,now:()=>clock+=10});
  const result=await runKalshiSourceQualification({client,retentionTermsResolved:false});
  assert.equal(result.get_request_count,2);
  assert.ok(result.get_request_count<=RELEASE04_MAX_GETS);
  assert.equal(result.candidate_events_inspected,1);
  assert.ok(result.candidate_events_inspected<=RELEASE04_MAX_CANDIDATE_EVENTS);
  assert.equal(result.selected_eligible_events,1);
  assert.equal(result.technical_source_ready,true);
  assert.equal(result.classification,"BLOCKED");
  assert.equal(result.raw_response_body_retained,false);
  assert.match(result.aggregate_raw_response_hash_set_digest,/^[a-f0-9]{64}$/u);
});

test("initial public-source HTTP failure becomes sanitized BLOCKED evidence instead of requiring a rerun", async () => {
  const fetchImpl=async()=>new Response("denied",{status:403});
  let clock=Date.parse(CUTOFF);
  const client=createKalshiPublicClient({fetchImpl,now:()=>clock+=10});
  const result=await runKalshiSourceQualification({client,retentionTermsResolved:false});
  assert.equal(result.get_request_count,1);
  assert.equal(result.events_request_success,false);
  assert.equal(result.request_error_count,1);
  assert.equal(result.rejection_reasons.events_request_failed,1);
  assert.equal(result.rejection_reasons.events_auth_error,1);
  assert.equal(result.technical_source_ready,false);
  assert.equal(result.classification,"BLOCKED");
});
