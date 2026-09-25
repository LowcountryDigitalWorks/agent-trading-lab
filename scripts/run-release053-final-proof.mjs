import { appendFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import {
  DeterministicCryptoStructProofRunner,
} from "../src/cryptostruct-proof-runner.mjs";
import {
  executeRelease053bFinalProof,
  release053bFreezeSurface,
  validateRelease053bAuthority,
} from "../src/release053b-final-proof.mjs";

const outputDir = process.env.RELEASE053_ARTIFACT_DIR ?? "release053-final-proof-artifact";

function flag(name) {
  return process.argv.includes(name);
}

function gitHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

function authorityFromEnvironment() {
  return {
    actual_runner_commit: gitHead(),
    authorized_runner_commit: process.env.RELEASE053_AUTHORIZED_RUNNER_COMMIT ?? "",
    proof_run_id: process.env.RELEASE053_PROOF_RUN_ID ?? "",
    authorized_proof_run_id: process.env.RELEASE053_AUTHORIZED_PROOF_RUN_ID ?? "",
    expected_source_contract_hash: process.env.RELEASE053_EXPECTED_SOURCE_CONTRACT_HASH ?? "",
    expected_event_universe_hash: process.env.RELEASE053_EXPECTED_EVENT_UNIVERSE_HASH ?? "",
    expected_query_plan_hash: process.env.RELEASE053_EXPECTED_QUERY_PLAN_HASH ?? "",
    expected_semantic_bundle_hash: process.env.RELEASE053_EXPECTED_SEMANTIC_BUNDLE_HASH ?? "",
    expected_quality_screen_config_hash:
      process.env.RELEASE053_EXPECTED_QUALITY_SCREEN_CONFIG_HASH ?? "",
    expected_diagnostic_contract_hash:
      process.env.RELEASE053_EXPECTED_DIAGNOSTIC_CONTRACT_HASH ?? "",
    expected_max_search_calls: process.env.RELEASE053_EXPECTED_MAX_SEARCH_CALLS ?? "",
    expected_max_get_instrument_calls:
      process.env.RELEASE053_EXPECTED_MAX_GET_INSTRUMENT_CALLS ?? "",
    expected_max_snapshot_calls:
      process.env.RELEASE053_EXPECTED_MAX_SNAPSHOT_CALLS ?? "",
    expected_max_total_attempts:
      process.env.RELEASE053_EXPECTED_MAX_TOTAL_ATTEMPTS ?? "",
    expected_max_unique_candidates:
      process.env.RELEASE053_EXPECTED_MAX_UNIQUE_CANDIDATES ?? "",
    expected_per_call_timeout_ms:
      process.env.RELEASE053_EXPECTED_PER_CALL_TIMEOUT_MS ?? "",
    expected_whole_proof_timeout_ms:
      process.env.RELEASE053_EXPECTED_WHOLE_PROOF_TIMEOUT_MS ?? "",
    expected_workflow_identity:
      process.env.RELEASE053_EXPECTED_WORKFLOW_IDENTITY ?? "",
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
      reconciled_reservations: reconciled.reconciled,
    }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
} else if (flag("--validate-only")) {
  try {
    const validated = validateRelease053bAuthority(authorityFromEnvironment());
    console.log(JSON.stringify({
      mode: "validate-only",
      runner_commit: validated.actual_runner_commit,
      proof_run_id: validated.proof_run_id,
      ...release053bFreezeSurface(),
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
    const result = await executeRelease053bFinalProof({
      outputDir,
      authority: authorityFromEnvironment(),
    });
    classification = result.classification;
    await githubOutput("classification", classification);
    console.log(JSON.stringify({
      proof_run_id: process.env.RELEASE053_PROOF_RUN_ID,
      classification,
      ...release053bFreezeSurface(),
      summary: result.summary,
    }));
  } catch (error) {
    await githubOutput("classification", classification);
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
