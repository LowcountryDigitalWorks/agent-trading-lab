import { canonicalSerialize, sha256Hex } from "./canonical.mjs";
import {
  KALSHI_API_BASE,
  evaluateSourceEligibility,
  qualificationCategory,
  schemaFingerprint,
  selectEventMarket,
} from "./phase0b.mjs";

export const RELEASE04_MAX_GETS = 250;
export const RELEASE04_MAX_CANDIDATE_EVENTS = 50;
export const KALSHI_OPEN_QUERY_STATUS = "open";
export const KALSHI_ACTIVE_MARKET_STATUS = "active";

function assert(condition, message) { if (!condition) throw new Error(message); }
function inc(map, key, amount = 1) { map[key] = (map[key] ?? 0) + amount; }
function endpointFamily(path) {
  if (path.startsWith("/events")) return "events";
  if (/^\/markets\/[^/]+\/orderbook/u.test(path)) return "market_orderbook";
  if (path.startsWith("/markets")) return "markets";
  if (path.startsWith("/series")) return "series";
  return "other_public_get";
}
function percentile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a,b) => a-b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1))];
}
function latencyStats(values) {
  if (!values.length) return { count:0,min_ms:null,p50_ms:null,p95_ms:null,max_ms:null,mean_ms:null };
  const sorted=[...values].sort((a,b)=>a-b);
  return {
    count:sorted.length,min_ms:sorted[0],p50_ms:percentile(sorted,.5),p95_ms:percentile(sorted,.95),
    max_ms:sorted.at(-1),mean_ms:sorted.reduce((a,b)=>a+b,0)/sorted.length,
  };
}
function presence(target, label, object, fields) {
  target[label] ??= Object.fromEntries(fields.map((field) => [field,{present:0,missing:0}]));
  for (const field of fields) {
    if (object && Object.hasOwn(object,field) && object[field] !== null && object[field] !== "") target[label][field].present += 1;
    else target[label][field].missing += 1;
  }
}
function spreadBucket(spread) {
  if (spread <= .02 + 1e-12) return "le_0_02";
  if (spread <= .05 + 1e-12) return "gt_0_02_le_0_05";
  if (spread <= .10 + 1e-12) return "gt_0_05_le_0_10";
  return "gt_0_10";
}

export function createKalshiPublicClient({
  fetchImpl = globalThis.fetch,
  baseUrl = KALSHI_API_BASE,
  maxGets = RELEASE04_MAX_GETS,
  now = () => Date.now(),
} = {}) {
  assert(typeof fetchImpl === "function","fetch implementation required");
  assert(Number.isInteger(maxGets) && maxGets > 0 && maxGets <= RELEASE04_MAX_GETS,"maxGets exceeds Release 0.4 ceiling");
  let count=0;
  const requests=[];
  async function getJson(path) {
    assert(typeof path === "string" && path.startsWith("/"),"path must be an API path");
    if (count >= maxGets) throw new Error("Release 0.4 GET request ceiling reached");
    count += 1;
    const start=now();
    let response;
    try {
      response=await fetchImpl(`${baseUrl}${path}`,{
        method:"GET",headers:{Accept:"application/json"},redirect:"follow",
      });
    } catch (error) {
      const end=now();
      requests.push({endpoint_family:endpointFamily(path),status:"network_error",status_code:null,latency_ms:Math.max(0,end-start)});
      throw error;
    }
    const end=now();
    const text=await response.text();
    const metadata={
      endpoint_family:endpointFamily(path),status:response.ok?"success":"http_error",
      status_code:response.status,latency_ms:Math.max(0,end-start),response_sha256:sha256Hex(text),
    };
    requests.push(metadata);
    if (!response.ok) throw new Error(`Kalshi public GET ${metadata.endpoint_family} returned HTTP ${response.status}`);
    let data;
    try { data=JSON.parse(text); } catch { throw new Error(`Kalshi public GET ${metadata.endpoint_family} returned malformed JSON`); }
    return {
      data,metadata,request_start_utc:new Date(start).toISOString(),request_complete_utc:new Date(end).toISOString(),
      schema_fingerprint:schemaFingerprint(data),
    };
  }
  return {
    getJson,
    get count(){return count;},
    get remaining(){return maxGets-count;},
    get requests(){return requests.map((x)=>({...x}));},
  };
}

export function classifySourceQualification(stats,{retentionTermsResolved=false}={}) {
  if (!retentionTermsResolved) return "BLOCKED";
  const technical=stats.events_request_success && stats.orderbook_successes>0 && stats.selected_eligible_events>0
    && stats.orderbook_auth_errors===0 && stats.schema_fingerprints.events.length>0 && stats.schema_fingerprints.orderbook.length>0;
  return technical?"QUALIFIED":"INSUFFICIENT";
}

export async function runKalshiSourceQualification({
  client,
  maxCandidateEvents=RELEASE04_MAX_CANDIDATE_EVENTS,
  retentionTermsResolved=false,
}={}) {
  assert(client && typeof client.getJson==="function","Kalshi public client required");
  assert(Number.isInteger(maxCandidateEvents) && maxCandidateEvents>0 && maxCandidateEvents<=RELEASE04_MAX_CANDIDATE_EVENTS,"candidate-event ceiling exceeded");

  const rejection={},categories={},allowedCategories={},spreads={},missing={};
  const fingerprints={events:new Set(),orderbook:new Set()};
  const responseHashes=[];
  let eventsRequestSuccess=false,returnedEvents=0,inspected=0,fullyEvaluated=0,selected=0,markets=0;
  let orderbookSuccesses=0,orderbookErrors=0,orderbookAuthErrors=0,budgetSkipped=0;
  let events=[];

  try {
    const result=await client.getJson(`/events?limit=${maxCandidateEvents}&status=${KALSHI_OPEN_QUERY_STATUS}&with_nested_markets=true`);
    eventsRequestSuccess=true;
    fingerprints.events.add(result.schema_fingerprint);
    responseHashes.push(result.metadata.response_sha256);
    events=Array.isArray(result.data?.events)?result.data.events.slice(0,maxCandidateEvents):[];
    returnedEvents=events.length;
    events.sort((a,b)=>String(a?.event_ticker??"").localeCompare(String(b?.event_ticker??"")));
  } catch (error) {
    inc(rejection,"events_request_failed");
    if (/HTTP 401|HTTP 403/u.test(error.message)) inc(rejection,"events_auth_error");
  }

  for (const event of events) {
    inspected += 1;
    presence(missing,"event",event,["event_ticker","series_ticker","title","category","settlement_sources","markets"]);
    const category=qualificationCategory(event);
    inc(categories,category.category);
    if (!category.eligible) { inc(rejection,category.reason); continue; }
    inc(allowedCategories,category.category);
    const eventMarkets=Array.isArray(event.markets)
      ? event.markets.filter((m)=>m?.market_type==="binary" && m?.status===KALSHI_ACTIVE_MARKET_STATUS)
      : [];
    markets += eventMarkets.length;
    if (!eventMarkets.length) { inc(rejection,"no_active_binary_markets"); continue; }
    if (eventMarkets.length > client.remaining) {
      budgetSkipped += 1; inc(rejection,"request_budget_insufficient_for_event_markets"); continue;
    }
    const candidates=[];
    for (const market of [...eventMarkets].sort((a,b)=>String(a.ticker).localeCompare(String(b.ticker)))) {
      presence(missing,"market",market,["ticker","event_ticker","market_type","status","close_time","rules_primary"]);
      try {
        const result=await client.getJson(`/markets/${encodeURIComponent(market.ticker)}/orderbook?depth=1`);
        orderbookSuccesses += 1;
        fingerprints.orderbook.add(result.schema_fingerprint);
        responseHashes.push(result.metadata.response_sha256);
        presence(missing,"orderbook",result.data?.orderbook_fp,["yes_dollars","no_dollars"]);
        const eligibility=evaluateSourceEligibility({event,market,orderbook:result.data,enforce_cutoff:false});
        if (!eligibility.eligible) inc(rejection,eligibility.reason);
        else inc(spreads,spreadBucket(eligibility.baseline.yes_spread));
        candidates.push({event,market,eligibility});
      } catch (error) {
        orderbookErrors += 1;
        if (/HTTP 401|HTTP 403/u.test(error.message)) orderbookAuthErrors += 1;
        inc(rejection,"orderbook_request_failed");
        candidates.push({event,market,eligibility:{eligible:false,reason:"source_request_failed",baseline:null}});
      }
    }
    fullyEvaluated += 1;
    try { selectEventMarket(candidates); selected += 1; }
    catch { inc(rejection,"no_eligible_market_after_orderbook_checks"); }
  }

  const requests=client.requests;
  const success=requests.filter((x)=>x.status==="success").length;
  const counts={};
  for (const request of requests) inc(counts,request.endpoint_family);
  const stats={
    source_base:KALSHI_API_BASE,source_version:"trade-api-v2",
    events_request_success:eventsRequestSuccess,get_request_count:client.count,get_request_ceiling:RELEASE04_MAX_GETS,
    returned_open_events:returnedEvents,candidate_events_inspected:inspected,candidate_event_ceiling:RELEASE04_MAX_CANDIDATE_EVENTS,
    fully_evaluated_allowed_events:fullyEvaluated,selected_eligible_events:selected,open_binary_markets_considered:markets,
    orderbook_successes:orderbookSuccesses,orderbook_errors:orderbookErrors,orderbook_auth_errors:orderbookAuthErrors,
    request_success_count:success,request_error_count:requests.length-success,budget_skipped_events:budgetSkipped,
    request_count_by_endpoint:counts,latency_ms:latencyStats(requests.map((x)=>x.latency_ms)),
    category_counts:Object.fromEntries(Object.entries(categories).sort()),
    allowed_category_counts:Object.fromEntries(Object.entries(allowedCategories).sort()),
    spread_eligibility_buckets:Object.fromEntries(Object.entries(spreads).sort()),
    rejection_reasons:Object.fromEntries(Object.entries(rejection).sort()),
    field_missingness:missing,
    schema_fingerprints:{events:[...fingerprints.events].sort(),orderbook:[...fingerprints.orderbook].sort()},
    current_eligible_event_fraction:inspected?selected/inspected:0,
    retention_terms_status:retentionTermsResolved?"resolved":"unresolved_for_exact_forward_snapshot_retention",
    raw_response_body_retained:false,
    aggregate_raw_response_hash_set_digest:sha256Hex(canonicalSerialize(responseHashes.sort())),
  };
  stats.technical_source_ready=stats.events_request_success && stats.orderbook_successes>0 && stats.selected_eligible_events>0 && stats.orderbook_auth_errors===0;
  stats.classification=classifySourceQualification(stats,{retentionTermsResolved});
  return stats;
}
