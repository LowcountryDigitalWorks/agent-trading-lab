import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRunManifest, runManifestDigest, validateRunManifest } from "../src/manifest.mjs";

async function loadManifest() {
  return JSON.parse(await readFile(new URL("./fixtures/run-manifest.v1.json", import.meta.url), "utf8"));
}

test("run manifest validates, freezes, and hashes deterministically", async () => {
  const raw = await loadManifest();
  const manifest = createRunManifest(raw);
  assert.ok(Object.isFrozen(manifest));
  assert.ok(Object.isFrozen(manifest.source));
  assert.equal(runManifestDigest(manifest), runManifestDigest(structuredClone(raw)));
});

test("run manifest rejects missing required provenance", async () => {
  const manifest = await loadManifest();
  delete manifest.source.version_ref;
  assert.throws(() => validateRunManifest(manifest), /version_ref/u);
});

test("run manifest rejects missing versioning metadata", async () => {
  const manifest = await loadManifest();
  delete manifest.model.adapter_version;
  assert.throws(() => validateRunManifest(manifest), /adapter_version/u);
});
