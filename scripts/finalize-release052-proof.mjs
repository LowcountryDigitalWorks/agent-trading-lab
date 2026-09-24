import { finalizeProofArtifacts } from "../src/cryptostruct-proof-runner.mjs";

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value) throw new Error(`${name} requires a value`);
  return value;
}

const outputDir = option("--output-dir", process.env.RELEASE052_ARTIFACT_DIR ?? "release052-artifact");
const classification = option(
  "--classification",
  process.env.RELEASE052_FINAL_CLASSIFICATION ?? "BLOCKED",
);

const manifest = await finalizeProofArtifacts(outputDir, { classification });
console.log(JSON.stringify({
  proof_run_id: manifest.proof_run_id,
  classification: manifest.classification,
  total_reserved_attempts: manifest.total_reserved_attempts,
  unique_candidate_count: manifest.unique_candidate_count,
  artifact_hash: manifest.artifact_hash,
}));
