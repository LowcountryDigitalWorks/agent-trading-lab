import test from "node:test";
import assert from "node:assert/strict";
import { canonicalSerialize, sha256Hex } from "../src/canonical.mjs";

test("canonical serialization sorts object keys recursively", () => {
  const left = { z: 1, a: { y: 2, b: 3 }, list: [{ q: 4, a: 5 }] };
  const right = { list: [{ a: 5, q: 4 }], a: { b: 3, y: 2 }, z: 1 };
  assert.equal(canonicalSerialize(left), canonicalSerialize(right));
  assert.equal(canonicalSerialize(left), '{"a":{"b":3,"y":2},"list":[{"a":5,"q":4}],"z":1}');
});

test("SHA-256 helper is deterministic and matches a known vector", () => {
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(sha256Hex({ b: 2, a: 1 }), sha256Hex({ a: 1, b: 2 }));
});

test("canonical serialization rejects ambiguous unsupported values", () => {
  assert.throws(() => canonicalSerialize({ value: Number.NaN }), /non-finite/u);
  assert.throws(() => canonicalSerialize({ value: undefined }), /undefined/u);
});
