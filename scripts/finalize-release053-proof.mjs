import {
  finalizeRelease053bProofArtifacts,
} from "../src/release053b-final-proof.mjs";

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value) throw new Error(`${name} requires a value`);
  return value;
}

const outputDir = option(
  "--output-dir",
  process.env.RELEASE053_ARTIFACT_DIR ?? "release053-final-proof-artifact",
);
const classification = option(
  "--classification",
  process.env.RELEASE053_FINAL_CLASSIFICATION ?? "BLOCKED",
);

const manifest = await finalizeRelease053bProofArtifacts(outputDir, {
  classification,
});
console.log(JSON.stringify({
  proof_run_id: manifest.proof_run_id,
  classification: manifest.classification,
  diagnostics_hash: manifest.diagnostics_hash,
  proof_summary_hash: manifest.proof_summary_hash,
  ledger_final_hash: manifest.ledger_final_hash,
  artifact_hash: manifest.artifact_hash,
}));
