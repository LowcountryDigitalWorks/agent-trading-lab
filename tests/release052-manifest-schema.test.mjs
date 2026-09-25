import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DeterministicCryptoStructProofRunner,
  finalizeProofArtifacts,
  validateProofManifest,
} from "../src/cryptostruct-proof-runner.mjs";
import { cryptoStructSourceContractHash } from "../src/cryptostruct-source.mjs";

async function readManifestSchema() {
  return JSON.parse(await readFile(
    new URL("../schemas/cryptostruct-proof-manifest.v1.schema.json", import.meta.url),
    "utf8",
  ));
}

function typeMatches(value, expected) {
  if (expected === "null") return value === null;
  if (expected === "integer") return Number.isInteger(value);
  if (expected === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  return typeof value === expected;
}

function assertSchemaNode(value, schema, label) {
  if (schema.type !== undefined) {
    const expectedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
    assert(
      expectedTypes.some((expected) => typeMatches(value, expected)),
      `${label} type mismatch`,
    );
  }

  if (Object.prototype.hasOwnProperty.call(schema, "const")) {
    assert.deepEqual(value, schema.const, `${label} const mismatch`);
  }
  if (Array.isArray(schema.enum)) {
    assert(schema.enum.includes(value), `${label} enum mismatch`);
  }
  if (typeof schema.minLength === "number") {
    assert.equal(typeof value, "string", `${label} must be string for minLength`);
    assert(value.length >= schema.minLength, `${label} minLength mismatch`);
  }
  if (typeof schema.minimum === "number") {
    assert.equal(typeof value, "number", `${label} must be number for minimum`);
    assert(value >= schema.minimum, `${label} minimum mismatch`);
  }
  if (typeof schema.pattern === "string" && value !== null) {
    assert.equal(typeof value, "string", `${label} must be string for pattern`);
    assert(new RegExp(schema.pattern, "u").test(value), `${label} pattern mismatch`);
  }
  if (schema.format === "date-time") {
    assert.equal(typeof value, "string", `${label} must be string for date-time`);
    assert(!Number.isNaN(Date.parse(value)), `${label} date-time mismatch`);
  }

  if (schema.type === "object" || (Array.isArray(schema.type) && schema.type.includes("object"))) {
    assert(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be object`);
    const required = schema.required ?? [];
    for (const key of required) {
      assert(
        Object.prototype.hasOwnProperty.call(value, key),
        `${label} missing required property: ${key}`,
      );
    }

    const properties = schema.properties ?? {};
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        assert(
          Object.prototype.hasOwnProperty.call(properties, key),
          `${label} unexpected property: ${key}`,
        );
      }
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        assertSchemaNode(value[key], childSchema, `${label}.${key}`);
      }
    }
  }
}

function assertManifestMatchesCheckedInSchema(manifest, schema) {
  assert.equal(
    schema.$id,
    "https://lowcountrydigitalworks.com/schemas/cryptostruct-proof-manifest.v1.schema.json",
  );
  assert.equal(schema.additionalProperties, false);
  assertSchemaNode(manifest, schema, "manifest");
  return manifest;
}

async function finalizedSyntheticManifest(t) {
  const outputDir = await mkdtemp(join(tmpdir(), "release052-schema-"));
  t.after(() => rm(outputDir, { recursive: true, force: true }));

  const runner = await DeterministicCryptoStructProofRunner.create({
    outputDir,
    proof_run_id: "release052-schema-contract-test",
    source_contract_hash: cryptoStructSourceContractHash(),
    runner_commit: "synthetic-schema-contract-commit",
    runner_version: "0.5.2",
    max_attempted_calls: 3,
    max_unique_candidates: 3,
    per_call_timeout_ms: 5_000,
    whole_proof_timeout_ms: 30_000,
    discovery_plan: [
      { q: "weather", class: "prediction", venue: "polymarket", limit: 1 },
    ],
    selector_config: { version: "synthetic-schema-contract.v1" },
    invokeTool: async () => {
      throw new Error("schema-contract test never dispatches source calls");
    },
    clock: () => "2026-09-24T04:00:00.000Z",
    nowMs: () => Date.parse("2026-09-24T04:00:00.000Z"),
  });
  runner.close();

  return finalizeProofArtifacts(outputDir, {
    classification: "BLOCKED",
    endedAt: "2026-09-24T04:01:00.000Z",
    clock: () => "2026-09-24T04:01:00.000Z",
  });
}

test("S4: finalized synthetic manifest with proof_summary_hash null matches checked-in v1 schema", async (t) => {
  const schema = await readManifestSchema();
  const manifest = await finalizedSyntheticManifest(t);

  assert.equal(manifest.schema_version, "cryptostruct-proof-manifest.v1");
  assert.equal(manifest.proof_summary_hash, null);
  assert.equal(validateProofManifest(manifest), manifest);
  assert.equal(assertManifestMatchesCheckedInSchema(manifest, schema), manifest);
});

test("S4: live-style valid SHA-256 proof_summary_hash matches runtime and checked-in schema", async (t) => {
  const schema = await readManifestSchema();
  const manifest = await finalizedSyntheticManifest(t);
  const liveStyle = {
    ...manifest,
    proof_summary_hash: "a".repeat(64),
  };

  assert.equal(validateProofManifest(liveStyle), liveStyle);
  assert.equal(assertManifestMatchesCheckedInSchema(liveStyle, schema), liveStyle);
});

test("S4: missing proof_summary_hash is rejected by runtime and checked-in schema contract", async (t) => {
  const schema = await readManifestSchema();
  const manifest = await finalizedSyntheticManifest(t);
  const missing = { ...manifest };
  delete missing.proof_summary_hash;

  assert.throws(() => validateProofManifest(missing), /proof_summary_hash/u);
  assert.throws(
    () => assertManifestMatchesCheckedInSchema(missing, schema),
    /missing required property: proof_summary_hash/u,
  );
});

test("S4: malformed non-null proof_summary_hash is rejected by runtime and checked-in schema contract", async (t) => {
  const schema = await readManifestSchema();
  const manifest = await finalizedSyntheticManifest(t);
  const malformed = {
    ...manifest,
    proof_summary_hash: "NOT-A-SHA256",
  };

  assert.throws(() => validateProofManifest(malformed), /proof_summary_hash/u);
  assert.throws(
    () => assertManifestMatchesCheckedInSchema(malformed, schema),
    /proof_summary_hash pattern mismatch/u,
  );
});

test("S4: unexpected manifest properties remain rejected", async (t) => {
  const schema = await readManifestSchema();
  const manifest = await finalizedSyntheticManifest(t);
  const extra = {
    ...manifest,
    unexpected_contract_field: true,
  };

  assert.throws(() => validateProofManifest(extra), /unknown field: unexpected_contract_field/u);
  assert.throws(
    () => assertManifestMatchesCheckedInSchema(extra, schema),
    /unexpected property: unexpected_contract_field/u,
  );
});

test("S4: runtime finalized manifest field set stays synchronized with checked-in required/property sets", async (t) => {
  const schema = await readManifestSchema();
  const manifest = await finalizedSyntheticManifest(t);

  assert(schema.required.includes("proof_summary_hash"));
  assert(Object.prototype.hasOwnProperty.call(schema.properties, "proof_summary_hash"));
  assert.deepEqual(
    schema.properties.proof_summary_hash,
    {
      type: ["string", "null"],
      pattern: "^[a-f0-9]{64}$",
    },
  );

  const runtimeFields = Object.keys(manifest).sort();
  assert.deepEqual([...schema.required].sort(), runtimeFields);
  assert.deepEqual(Object.keys(schema.properties).sort(), runtimeFields);
});
