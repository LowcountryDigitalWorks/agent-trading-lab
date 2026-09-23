import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { canonicalSerialize, sha256Hex } from "../src/canonical.mjs";
import { buildPhase0bEvidence, BOOTSTRAP_RESAMPLES, BOOTSTRAP_SEED, KALSHI_API_BASE } from "../src/phase0b.mjs";
import { createKalshiPublicClient, runKalshiSourceQualification, RELEASE04_MAX_CANDIDATE_EVENTS, RELEASE04_MAX_GETS } from "../src/kalshi-public.mjs";
import { createRunManifest, runManifestDigest } from "../src/manifest.mjs";

function args(argv) {
  const out={};
  for(let i=0;i<argv.length;i+=2){
    const key=argv[i],value=argv[i+1];
    if(!key?.startsWith("--")||value===undefined) throw new Error(`invalid argument near ${key??"<end>"}`);
    out[key.slice(2)]=value;
  }
  return out;
}
function required(values,key){if(!values[key])throw new Error(`missing --${key}`);return values[key];}
function jsonFile(path,value){return writeFile(path,`${JSON.stringify(value,null,2)}\n`,"utf8");}

const options=args(process.argv.slice(2));
const outputDirectory=resolve(required(options,"output-dir"));
const gitCommit=required(options,"git-commit");
const proofStartedAt=required(options,"proof-started-at-utc");
if(!/^[a-f0-9]{40}$/u.test(gitCommit)) throw new Error("git commit must be a full SHA");
if(!proofStartedAt.endsWith("Z")||Number.isNaN(Date.parse(proofStartedAt))) throw new Error("proof start must be ISO UTC");

const client=createKalshiPublicClient({maxGets:RELEASE04_MAX_GETS});
const stats=await runKalshiSourceQualification({
  client,
  maxCandidateEvents:RELEASE04_MAX_CANDIDATE_EVENTS,
  retentionTermsResolved:false,
});
const proofCompletedAt=new Date().toISOString();

const responseSetHash=stats.aggregate_raw_response_hash_set_digest;
const aggregateHash=sha256Hex(canonicalSerialize(stats));
const environmentHash=sha256Hex(canonicalSerialize({
  node_major:22,
  package_lock_sha256:sha256Hex(await (await import("node:fs/promises")).readFile(new URL("../package-lock.json",import.meta.url),"utf8")),
  source_base:KALSHI_API_BASE,
  proof_limits:{max_gets:RELEASE04_MAX_GETS,max_candidate_events:RELEASE04_MAX_CANDIDATE_EVENTS},
}));

const manifest=createRunManifest({
  schema_version:"run-manifest.v1",
  run_id:"release04-kalshi-source-qualification",
  experiment_id:"phase0b-source-qualification",
  track:"0B",
  created_at_utc:proofCompletedAt,
  source:{
    name:"Kalshi public unauthenticated REST market data",
    version_ref:"trade-api-v2",
    upstream_url:"https://docs.kalshi.com/getting_started/quick_start_market_data",
    retrieved_at_utc:proofCompletedAt,
    license_ref:"Public unauthenticated market-data access documented; exact normalized forward-snapshot retention/redistribution terms unresolved for future OOS",
    coverage:{start_utc:proofStartedAt,end_utc:proofCompletedAt},
    counts:{rows:stats.request_success_count,events:stats.candidate_events_inspected,markets:stats.open_binary_markets_considered},
    timezone:"UTC",
    raw_inputs:[{name:"aggregate-live-response-hash-set",sha256:responseSetHash}],
  },
  derived_artifacts:[{name:"sanitized-source-qualification-statistics",sha256:aggregateHash,parent_hashes:[responseSetHash]}],
  transform_code_commit:gitCommit,
  integrations:{freqtrade_ref:null,prediction_market_bench_ref:null},
  model:{provider:null,model_id:null,model_version:null,prompt_version:null,prompt_hash:null,adapter_version:"phase0b-source-qualification/0.4.0",schema_hash:sha256Hex("release-0.1-contracts-reused")},
  deterministic_seeds:{event_cluster_bootstrap:BOOTSTRAP_SEED},
  git_commit:gitCommit,
  environment_lock_hash:environmentHash,
  execution_config:{
    release:"0.4",purpose:"source qualification + forecast harness only",
    source_base:KALSHI_API_BASE,authentication:"NONE",api_key:false,model_calls:0,trading_orders:0,
    max_get_requests:RELEASE04_MAX_GETS,max_candidate_events:RELEASE04_MAX_CANDIDATE_EVENTS,
    raw_response_body_retained:false,oos_collection_started:false,pnl_or_execution_layer:false,
    bootstrap_resamples_future:BOOTSTRAP_RESAMPLES,retention_terms_status:stats.retention_terms_status,
  },
  cost_config:{incremental_cash_usd:0,real_capital_usd:0},
  partitions:[{name:"source-qualification-only",fraction:1,locked:true}],
  allowed_redesign_count:0,
});

const evidence=buildPhase0bEvidence({
  runId:"release04-kalshi-source-qualification",
  recordedAtUtc:proofCompletedAt,
  entries:[
    {event_type:"run_started",payload:{release:"0.4",proof_started_at_utc:proofStartedAt,limits:{max_gets:RELEASE04_MAX_GETS,max_candidate_events:RELEASE04_MAX_CANDIDATE_EVENTS}}},
    {event_type:"metric",payload:{source_qualification:stats}},
    {event_type:"run_closed",payload:{classification:stats.classification,technical_source_ready:stats.technical_source_ready}},
  ],
});

const summary={
  release:"0.4",
  purpose:"Phase 0B forecast harness & Kalshi public-source qualification; no model efficacy test",
  exact_candidate_head:gitCommit,
  source:{base:KALSHI_API_BASE,version:"trade-api-v2",authentication:"NONE"},
  limits:{max_get_requests:RELEASE04_MAX_GETS,max_candidate_events:RELEASE04_MAX_CANDIDATE_EVENTS},
  classification:stats.classification,
  technical_source_ready:stats.technical_source_ready,
  qualification:stats,
  manifest_digest:runManifestDigest(manifest),
  evidence_digest:evidence.digest,
  retained_files:["proof-summary.json","run-manifest.json","qualification-evidence.jsonl"],
  raw_response_body_retained:false,
  model_calls:0,trading_orders:0,incremental_cash_usd:0,real_capital_usd:0,
};

await mkdir(outputDirectory,{recursive:true});
await Promise.all([
  jsonFile(resolve(outputDirectory,"proof-summary.json"),summary),
  jsonFile(resolve(outputDirectory,"run-manifest.json"),manifest),
  writeFile(resolve(outputDirectory,"qualification-evidence.jsonl"),`${evidence.records.map((r)=>canonicalSerialize(r)).join("\n")}\n`,"utf8"),
]);
process.stdout.write(`${JSON.stringify({
  release:summary.release,classification:summary.classification,technical_source_ready:summary.technical_source_ready,
  get_request_count:stats.get_request_count,candidate_events_inspected:stats.candidate_events_inspected,
  selected_eligible_events:stats.selected_eligible_events,request_error_count:stats.request_error_count,
  orderbook_successes:stats.orderbook_successes,orderbook_errors:stats.orderbook_errors,
  latency_ms:stats.latency_ms,retention_terms_status:stats.retention_terms_status,
  manifest_digest:summary.manifest_digest,evidence_digest:summary.evidence_digest,
},null,2)}\n`);
