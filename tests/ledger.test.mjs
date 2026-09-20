import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  EvidenceLedgerWriter,
  buildEvidenceRecord,
  canonicalLedgerDigest,
  computeEvidenceRecordHash,
  parseLedgerJsonl,
  validateLedgerRecords,
} from "../src/ledger.mjs";

function makeLedger(times = ["2026-01-01T00:00:00Z", "2026-01-01T00:00:01Z", "2026-01-01T00:00:02Z"]) {
  const records = [];
  for (let index = 0; index < 3; index += 1) {
    records.push(buildEvidenceRecord({
      run_id: "run-1",
      sequence: index,
      event_type: index === 0 ? "run_started" : index === 2 ? "run_closed" : "metric",
      recorded_at_utc: times[index],
      payload: index === 1 ? { metric: "synthetic", value: 1 } : { phase: index === 0 ? "start" : "close" },
      prev_record_hash: index === 0 ? null : records[index - 1].record_hash,
    }));
  }
  return records;
}

test("valid evidence ledger hash chain validates", () => {
  const records = makeLedger();
  assert.deepEqual(validateLedgerRecords(records), { valid: true, count: 3, last_record_hash: records[2].record_hash });
});

test("ledger validator detects payload tampering", () => {
  const records = structuredClone(makeLedger());
  records[1].payload.value = 999;
  assert.throws(() => validateLedgerRecords(records), /record hash mismatch/u);
});

test("ledger validator detects changed prior hashes even when the changed record is rehashed", () => {
  const records = structuredClone(makeLedger());
  records[1].prev_record_hash = "0".repeat(64);
  records[1].record_hash = computeEvidenceRecordHash(records[1]);
  assert.throws(() => validateLedgerRecords(records), /previous-hash link mismatch/u);
});

test("ledger validator detects a missing chain record", () => {
  const records = makeLedger();
  const missing = [records[0], records[2]];
  assert.throws(() => validateLedgerRecords(missing), /sequence mismatch/u);
});

test("canonical ledger digest normalizes only wall-clock wrapper metadata", () => {
  const first = makeLedger();
  const second = makeLedger(["2026-02-01T00:00:00Z", "2026-02-01T00:00:01Z", "2026-02-01T00:00:02Z"]);
  assert.notEqual(first[2].record_hash, second[2].record_hash);
  assert.equal(canonicalLedgerDigest(first), canonicalLedgerDigest(second));
});

test("file writer appends JSONL and can resume only after validation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ldw-ledger-"));
  const path = join(directory, "evidence.jsonl");
  try {
    const writer = await EvidenceLedgerWriter.createNew(path, "run-file", { clock: () => "2026-01-01T00:00:00Z" });
    await writer.append("run_started", { fixture: true });
    await writer.append("run_closed", { fixture: true }, { recorded_at_utc: "2026-01-01T00:00:01Z" });
    const parsed = parseLedgerJsonl(await readFile(path, "utf8"));
    assert.equal(validateLedgerRecords(parsed).count, 2);
    const resumed = await EvidenceLedgerWriter.resume(path, { clock: () => "2026-01-01T00:00:02Z" });
    const appended = await resumed.append("metric", { after_resume: true });
    assert.equal(appended.sequence, 2);
    assert.equal(validateLedgerRecords(parseLedgerJsonl(await readFile(path, "utf8"))).count, 3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
