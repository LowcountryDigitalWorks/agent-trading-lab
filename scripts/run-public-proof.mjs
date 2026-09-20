import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { canonicalSerialize, sha256Hex } from "../src/canonical.mjs";
import { PROOF_END_UTC, PROOF_START_UTC, loadFreqtradeProofArtifacts } from "../src/freqtrade-artifacts.mjs";
import { NOMINAL_COSTS, STRESS_COSTS, runPhase0AProof } from "../src/phase0a.mjs";
import { createRunManifest, runManifestDigest } from "../src/manifest.mjs";

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

const artifacts = await loadFreqtradeProofArtifacts(dataDirectory);
const proof = runPhase0AProof(artifacts.datasets);
const totalTrades = Object.values(artifacts.diagnostics).reduce((sum, item) => sum + item.trades.count, 0);
const totalCandles = Object.values(artifacts.diagnostics).reduce((sum, item) => sum + item["5m"].count + item["1h"].count, 0);
const packageLock = await readFile(new URL("../package-lock.json", import.meta.url), "utf8");
const environmentLockHash = sha256Hex(canonicalSerialize({
  package_lock_sha256: sha256Hex(packageLock),
  freqtrade_image_digest: freqtradeImageDigest,
  freqtrade_tag_commit: "9f10e357a93c1dcf10c2a2b367659214d89c073e",
  node_major: 22,
}));
const candidateCount = proof.nominal.metrics.candidate_count;
const manifest = createRunManifest({
  schema_version: "run-manifest.v1",
  run_id: "phase0a-kraken-public-proof-2026-08",
  experiment_id: "phase0a-kraken-2026-08",
  track: "0A",
  created_at_utc: acquiredAtUtc,
  source: {
    name: "Kraken spot public historical trades via external Freqtrade CLI",
    version_ref: `Freqtrade ${freqtradeVersion.trim()} tag 2026.8 commit 9f10e357a93c1dcf10c2a2b367659214d89c073e; image ${freqtradeImageDigest}`,
    upstream_url: "https://github.com/freqtrade/freqtrade/releases/tag/2026.8",
    retrieved_at_utc: acquiredAtUtc,
    license_ref: "Freqtrade GPLv3 external CLI boundary; Kraken public market data subject to Kraken terms; no raw dataset redistributed",
    coverage: { start_utc: PROOF_START_UTC, end_utc: PROOF_END_UTC },
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
    adapter_version: "phase0a-ema20-ema50/0.2.0",
    schema_hash: sha256Hex("release-0.1-contracts@bd007bc8f88d25afe8eedf375824709e5d963e8e"),
  },
  deterministic_seeds: { replay: 0 },
  git_commit: gitCommit,
  environment_lock_hash: environmentLockHash,
  execution_config: {
    exchange: "kraken",
    trading_mode: "spot",
    pairs: ["BTC/USDT", "ETH/USDT"],
    timeframes: ["5m", "1h"],
    proof_window_start_utc: PROOF_START_UTC,
    proof_window_end_exclusive_utc: PROOF_END_UTC,
    acquisition_command: acquisitionCommand,
    decision_rule: "closed 1h EMA20/EMA50 transition",
    nominal_fill_alignment: "first 5m bar strictly after decision timestamp",
    stress_latency: "one additional 5m bar",
    liquidity_rule: "order notional <= 0.1% of sum(price * amount) quote volume in execution 5m bucket",
    starting_virtual_equity: 10000,
    entry_stake_fraction: 0.1,
    max_aggregate_exposure_fraction: 0.2,
    daily_loss_fraction: 0.02,
    hard_drawdown_fraction: 0.1,
  },
  cost_config: { nominal: NOMINAL_COSTS, stress: STRESS_COSTS },
  partitions: [{ name: "frozen-public-proof-window", fraction: 1, locked: true }],
  allowed_redesign_count: 0,
});

const summary = {
  release: "0.2",
  purpose: "measurement integration proof; not an alpha claim",
  proof_window: { start_utc: PROOF_START_UTC, end_exclusive_utc: PROOF_END_UTC },
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
  counts: {
    raw_trade_rows: totalTrades,
    normalized_candle_rows: totalCandles,
    candidate_count: candidateCount,
    nominal_fills: proof.nominal.metrics.accepted_fill_count,
    nominal_rejections: proof.nominal.metrics.rejected_fill_count,
    stress_fills: proof.stress.metrics.accepted_fill_count,
    stress_rejections: proof.stress.metrics.rejected_fill_count,
    nominal_evidence_events: proof.nominal.metrics.evidence_count,
    stress_evidence_events: proof.stress.metrics.evidence_count,
  },
  evidence: {
    nominal_canonical_digest: proof.nominal.evidence_digest,
    stress_canonical_digest: proof.stress.evidence_digest,
  },
  nominal_metrics: proof.nominal.metrics,
  stress_metrics: proof.stress.metrics,
  comparison: proof.comparison,
  cost_model_monotonicity_pass: proof.cost_model_monotonicity_pass,
  manifest_digest: runManifestDigest(manifest),
  raw_market_data_committed: false,
  positive_pnl_is_alpha_claim: false,
};

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(resolve(outputDirectory, "proof-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8"),
  writeFile(resolve(outputDirectory, "run-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
  writeFile(resolve(outputDirectory, "evidence-nominal.jsonl"), ledgerJsonl(proof.nominal.evidence), "utf8"),
  writeFile(resolve(outputDirectory, "evidence-stress.jsonl"), ledgerJsonl(proof.stress.evidence), "utf8"),
]);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
