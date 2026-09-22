import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { canonicalSerialize, sha256Hex } from "../src/canonical.mjs";
import {
  RELEASE03_END_MS,
  RELEASE03_END_UTC,
  RELEASE03_START_MS,
  RELEASE03_START_UTC,
  loadFreqtradeProofArtifacts,
} from "../src/freqtrade-artifacts.mjs";
import { createRunManifest, runManifestDigest } from "../src/manifest.mjs";
import { NOMINAL_COSTS, STRESS_COSTS } from "../src/phase0a.mjs";
import {
  RELEASE03_CONTROL_STAKE,
  RELEASE03_EXPERIMENT_ID,
  RELEASE03_SENSITIVITY_STAKE,
  runRelease03ExecutabilitySensitivity,
} from "../src/release03.mjs";

function args(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(`invalid argument near ${key ?? "<end>"}`);
    values[key.slice(2)] = value;
  }
  return values;
}

function required(values, key) {
  const value = values[key];
  if (!value) throw new Error(`missing --${key}`);
  return value;
}

function ledgerJsonl(records) {
  return `${records.map((record) => canonicalSerialize(record)).join("\n")}\n`;
}

function scenarioManifest({
  artifacts,
  acquiredAtUtc,
  acquisitionCommand,
  gitCommit,
  environmentLockHash,
  freqtradeVersion,
  freqtradeImageDigest,
  run,
  scenario,
  stake,
  costs,
  signalStreamDigest,
  totalTrades,
  totalCandles,
}) {
  const runId = run.evidence[0].run_id;
  return createRunManifest({
    schema_version: "run-manifest.v1",
    run_id: runId,
    experiment_id: RELEASE03_EXPERIMENT_ID,
    track: "0A",
    created_at_utc: acquiredAtUtc,
    source: {
      name: "Kraken spot public historical trades via external Freqtrade CLI",
      version_ref: `Freqtrade ${freqtradeVersion.trim()} tag 2026.8 commit 9f10e357a93c1dcf10c2a2b367659214d89c073e; image ${freqtradeImageDigest}`,
      upstream_url: "https://github.com/freqtrade/freqtrade/releases/tag/2026.8",
      retrieved_at_utc: acquiredAtUtc,
      license_ref: "Freqtrade GPLv3 external CLI boundary; Kraken public market data subject to Kraken terms; no raw dataset redistributed",
      coverage: { start_utc: RELEASE03_START_UTC, end_utc: RELEASE03_END_UTC },
      counts: { rows: totalTrades + totalCandles, events: totalTrades, markets: 2 },
      timezone: "UTC",
      raw_inputs: artifacts.rawInputs,
    },
    derived_artifacts: artifacts.derivedArtifacts,
    transform_code_commit: gitCommit,
    integrations: {
      freqtrade_ref: `2026.8@9f10e357a93c1dcf10c2a2b367659214d89c073e;${freqtradeImageDigest}`,
      prediction_market_bench_ref: null,
    },
    model: {
      provider: null,
      model_id: null,
      model_version: null,
      prompt_version: null,
      prompt_hash: null,
      adapter_version: "phase0a-ema20-ema50/0.3.0",
      schema_hash: sha256Hex("release-0.1-contracts@bd007bc8f88d25afe8eedf375824709e5d963e8e"),
    },
    deterministic_seeds: { replay: 0 },
    git_commit: gitCommit,
    environment_lock_hash: environmentLockHash,
    execution_config: {
      release: "0.3",
      purpose: "engineering executability sensitivity; not strategy-alpha evidence",
      engineering_coverage_window_only: true,
      exchange: "kraken",
      trading_mode: "spot",
      pairs: ["BTC/USDT", "ETH/USDT"],
      timeframes: ["5m", "1h"],
      proof_window_start_utc: RELEASE03_START_UTC,
      proof_window_end_exclusive_utc: RELEASE03_END_UTC,
      acquisition_command: acquisitionCommand,
      scenario,
      entry_stake_fraction: stake,
      canonical_default_entry_stake_fraction: RELEASE03_CONTROL_STAKE,
      sensitivity_entry_stake_fraction: RELEASE03_SENSITIVITY_STAKE,
      signal_stream_digest: signalStreamDigest,
      decision_rule: "closed 1h EMA20/EMA50 transition",
      nominal_fill_alignment: "exact T+5m",
      stress_fill_alignment: "exact T+10m",
      missing_exact_execution_bucket: "missing_execution_data -> SKIP",
      liquidity_rule: "order notional <= 0.1% of sum(price * amount) quote volume in execution 5m bucket",
      starting_virtual_equity: 10000,
      max_aggregate_exposure_fraction: 0.2,
      daily_loss_fraction: 0.02,
      hard_drawdown_fraction: 0.1,
    },
    cost_config: costs,
    partitions: [{ name: "engineering-coverage-2026-05-through-08", fraction: 1, locked: true }],
    allowed_redesign_count: 0,
  });
}

function scenarioSummary(name, run, summary, signalStream, scaleDiagnostics, sourceIdentity) {
  return {
    name,
    ...summary,
    raw_and_normalized_source_hashes: sourceIdentity,
    signal_stream_digest: signalStream.digest,
    scale_conversion_digest: scaleDiagnostics.digest,
    evidence_chain_valid: run.evidence_chain_valid,
    reproducible_canonical_digest: run.reproducible_digest,
  };
}

const options = args(process.argv.slice(2));
const dataDirectory = resolve(required(options, "data-dir"));
const outputDirectory = resolve(required(options, "output-dir"));
const gitCommit = required(options, "git-commit");
const freqtradeVersion = required(options, "freqtrade-version");
const freqtradeImageDigest = required(options, "freqtrade-image-digest");
const acquiredAtUtc = required(options, "acquired-at-utc");
const acquisitionCommand = required(options, "acquisition-command");

if (!freqtradeVersion.includes("2026.8")) throw new Error(`Freqtrade version mismatch: ${freqtradeVersion}`);
if (!/^[a-f0-9]{40}$/u.test(gitCommit)) throw new Error("git commit must be a full SHA-1 commit id");
if (!acquiredAtUtc.endsWith("Z") || Number.isNaN(Date.parse(acquiredAtUtc))) throw new Error("acquired-at-utc must be an ISO UTC timestamp");

const artifacts = await loadFreqtradeProofArtifacts(dataDirectory, {
  startMs: RELEASE03_START_MS,
  endMs: RELEASE03_END_MS,
});
const proof = runRelease03ExecutabilitySensitivity(artifacts.datasets);

const totalTrades = Object.values(artifacts.diagnostics).reduce((sum, item) => sum + item.trades.count, 0);
const totalCandles = Object.values(artifacts.diagnostics).reduce((sum, item) => sum + item["5m"].count + item["1h"].count, 0);
const packageLock = await readFile(new URL("../package-lock.json", import.meta.url), "utf8");
const environmentLockHash = sha256Hex(canonicalSerialize({
  package_lock_sha256: sha256Hex(packageLock),
  freqtrade_image_digest: freqtradeImageDigest,
  freqtrade_tag_commit: "9f10e357a93c1dcf10c2a2b367659214d89c073e",
  node_major: 22,
}));

const definitions = {
  control_10pct_nominal: { stake: RELEASE03_CONTROL_STAKE, costs: NOMINAL_COSTS },
  control_10pct_stress: { stake: RELEASE03_CONTROL_STAKE, costs: STRESS_COSTS },
  sensitivity_1pct_nominal: { stake: RELEASE03_SENSITIVITY_STAKE, costs: NOMINAL_COSTS },
  sensitivity_1pct_stress: { stake: RELEASE03_SENSITIVITY_STAKE, costs: STRESS_COSTS },
};
const manifests = {};
for (const [name, definition] of Object.entries(definitions)) {
  manifests[name] = scenarioManifest({
    artifacts,
    acquiredAtUtc,
    acquisitionCommand,
    gitCommit,
    environmentLockHash,
    freqtradeVersion,
    freqtradeImageDigest,
    run: proof.runs[name],
    scenario: name,
    stake: definition.stake,
    costs: definition.costs,
    signalStreamDigest: proof.signal_stream.digest,
    totalTrades,
    totalCandles,
  });
}

const scenarios = {
  control_10pct_nominal: scenarioSummary(
    "control_10pct_nominal",
    proof.runs.control_10pct_nominal,
    proof.summaries.control_10pct_nominal,
    proof.signal_stream,
    proof.scale_conversion.nominal,
    proof.signal_stream.source_identity,
  ),
  control_10pct_stress: scenarioSummary(
    "control_10pct_stress",
    proof.runs.control_10pct_stress,
    proof.summaries.control_10pct_stress,
    proof.signal_stream,
    proof.scale_conversion.stress,
    proof.signal_stream.source_identity,
  ),
  sensitivity_1pct_nominal: scenarioSummary(
    "sensitivity_1pct_nominal",
    proof.runs.sensitivity_1pct_nominal,
    proof.summaries.sensitivity_1pct_nominal,
    proof.signal_stream,
    proof.scale_conversion.nominal,
    proof.signal_stream.source_identity,
  ),
  sensitivity_1pct_stress: scenarioSummary(
    "sensitivity_1pct_stress",
    proof.runs.sensitivity_1pct_stress,
    proof.summaries.sensitivity_1pct_stress,
    proof.signal_stream,
    proof.scale_conversion.stress,
    proof.signal_stream.source_identity,
  ),
};

const summary = {
  release: "0.3",
  purpose: "Phase 0A engineering executability sensitivity; not a strategy-alpha experiment",
  engineering_coverage_window_only: true,
  proof_window: { start_utc: RELEASE03_START_UTC, end_exclusive_utc: RELEASE03_END_UTC },
  stakes: {
    canonical_control: RELEASE03_CONTROL_STAKE,
    engineering_sensitivity: RELEASE03_SENSITIVITY_STAKE,
  },
  freqtrade: {
    requested_tag: "2026.8",
    tag_commit: "9f10e357a93c1dcf10c2a2b367659214d89c073e",
    runtime_version: freqtradeVersion.trim(),
    docker_image_digest: freqtradeImageDigest,
    acquisition_command: acquisitionCommand,
    acquired_at_utc: acquiredAtUtc,
  },
  raw_artifacts: artifacts.rawInputs,
  derived_artifacts: artifacts.derivedArtifacts,
  data_quality: artifacts.diagnostics,
  source_identity: proof.signal_stream.source_identity,
  signal_stream: {
    digest: proof.signal_stream.digest,
    opportunity_count: proof.signal_stream.opportunities.length,
    actionable_signal_opportunities: proof.signal_stream.actionable_signal_opportunities,
    actionable_entry_opportunities: proof.signal_stream.actionable_entry_opportunities,
  },
  scale_conversion: {
    nominal: proof.scale_conversion.nominal,
    stress: proof.scale_conversion.stress,
  },
  scenarios,
  lifecycle_pass: proof.lifecycle_pass,
  classification: proof.classification,
  manifest_digests: Object.fromEntries(
    Object.entries(manifests).map(([name, manifest]) => [name, runManifestDigest(manifest)]),
  ),
  raw_market_data_committed: false,
  pnl_is_secondary_diagnostic_only: true,
  positive_pnl_is_alpha_claim: false,
  no_automatic_follow_on_sensitivity: true,
};

await mkdir(outputDirectory, { recursive: true });
const writes = [
  writeFile(resolve(outputDirectory, "proof-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8"),
  writeFile(
    resolve(outputDirectory, "signal-stream.json"),
    `${JSON.stringify({
      digest: proof.signal_stream.digest,
      source_identity: proof.signal_stream.source_identity,
      opportunities: proof.signal_stream.opportunities,
    }, null, 2)}\n`,
    "utf8",
  ),
  writeFile(resolve(outputDirectory, "scale-conversion-nominal.json"), `${JSON.stringify(proof.scale_conversion.nominal, null, 2)}\n`, "utf8"),
  writeFile(resolve(outputDirectory, "scale-conversion-stress.json"), `${JSON.stringify(proof.scale_conversion.stress, null, 2)}\n`, "utf8"),
];

for (const [name, run] of Object.entries(proof.runs)) {
  writes.push(writeFile(resolve(outputDirectory, `evidence-${name}.jsonl`), ledgerJsonl(run.evidence), "utf8"));
  writes.push(writeFile(resolve(outputDirectory, `run-manifest-${name}.json`), `${JSON.stringify(manifests[name], null, 2)}\n`, "utf8"));
}

await Promise.all(writes);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
