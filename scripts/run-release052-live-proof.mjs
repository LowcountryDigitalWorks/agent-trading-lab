import { appendFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import {
  DeterministicCryptoStructProofRunner,
} from "../src/cryptostruct-proof-runner.mjs";
import {
  executeRelease052LiveProof,
  release052Stage2Hashes,
  validateRelease052LiveAuthority,
} from "../src/release052-live-proof.mjs";

const outputDir = process.env.RELEASE052_ARTIFACT_DIR ?? "release052-live-artifact";

function flag(name) {
  return process.argv.includes(name);
}

function gitHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

function authorityFromEnvironment() {
  return {
    actual_runner_commit: gitHead(),
    authorized_runner_commit: process.env.RELEASE052_AUTHORIZED_RUNNER_COMMIT ?? "",
    proof_run_id: process.env.RELEASE052_PROOF_RUN_ID ?? "",
    authorized_proof_run_id: process.env.RELEASE052_AUTHORIZED_PROOF_RUN_ID ?? "",
    expected_source_contract_hash: process.env.RELEASE052_EXPECTED_SOURCE_CONTRACT_HASH ?? "",
    expected_discovery_plan_hash: process.env.RELEASE052_EXPECTED_DISCOVERY_PLAN_HASH ?? "",
    expected_selector_config_hash: process.env.RELEASE052_EXPECTED_SELECTOR_CONFIG_HASH ?? "",
    expected_max_attempted_calls: process.env.RELEASE052_EXPECTED_MAX_ATTEMPTED_CALLS ?? "",
    expected_max_unique_candidates: process.env.RELEASE052_EXPECTED_MAX_UNIQUE_CANDIDATES ?? "",
    expected_per_call_timeout_ms: process.env.RELEASE052_EXPECTED_PER_CALL_TIMEOUT_MS ?? "",
    expected_whole_proof_timeout_ms: process.env.RELEASE052_EXPECTED_WHOLE_PROOF_TIMEOUT_MS ?? "",
    independent_semantic_bundle: process.env.RELEASE052_INDEPENDENT_SEMANTIC_BUNDLE_JSON ?? "",
    expected_independent_semantic_bundle_hash:
      process.env.RELEASE052_EXPECTED_INDEPENDENT_SEMANTIC_BUNDLE_HASH ?? "",
  };
}

async function githubOutput(name, value) {
  const output = process.env.GITHUB_OUTPUT;
  if (!output) return;
  await appendFile(output, name + "=" + value + "\n", "utf8");
}

if (flag("--reconcile-only")) {
  try {
    const runner = await DeterministicCryptoStructProofRunner.resume({
      outputDir,
      invokeTool: async () => {
        throw new Error("reconciliation mode never dispatches source calls");
      },
    });
    const reconciled = await runner.reconcileOutstandingReservations();
    runner.close();
    console.log(JSON.stringify({
      mode: "reconcile-only",
      reconciled_reservations: reconciled.length,
    }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
} else if (flag("--validate-only")) {
  try {
    const validated = validateRelease052LiveAuthority(authorityFromEnvironment());
    console.log(JSON.stringify({
      mode: "validate-only",
      runner_commit: validated.actual_runner_commit,
      proof_run_id: validated.proof_run_id,
      ...release052Stage2Hashes(),
      independent_semantic_bundle_hash: validated.independent_semantic_bundle_hash,
      reservations: 0,
      data_returning_calls: 0,
    }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
} else {
  let classification = "BLOCKED";
  try {
    const result = await executeRelease052LiveProof({
      outputDir,
      authority: authorityFromEnvironment(),
    });
    classification = result.classification;
    await githubOutput("classification", classification);
    console.log(JSON.stringify({
      proof_run_id: process.env.RELEASE052_PROOF_RUN_ID,
      classification,
      ...release052Stage2Hashes(),
      summary: result.summary,
    }));
  } catch (error) {
    await githubOutput("classification", classification);
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
