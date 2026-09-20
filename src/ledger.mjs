import { appendFile, readFile, writeFile } from "node:fs/promises";
import { canonicalSerialize, sha256Hex } from "./canonical.mjs";
import { validateEvidenceEvent } from "./contracts.mjs";

function withoutRecordHash(record) {
  const { record_hash: _recordHash, ...material } = record;
  return material;
}

export function computeEvidenceRecordHash(record) {
  return sha256Hex(canonicalSerialize(withoutRecordHash(record)));
}

export function buildEvidenceRecord({ run_id, sequence, event_type, recorded_at_utc, payload, prev_record_hash }) {
  const record = {
    schema_version: "evidence-event.v1",
    run_id,
    sequence,
    event_type,
    recorded_at_utc,
    payload,
    prev_record_hash,
    record_hash: "0".repeat(64),
  };
  record.record_hash = computeEvidenceRecordHash(record);
  validateEvidenceEvent(record);
  return record;
}

export function validateLedgerRecords(records) {
  if (!Array.isArray(records)) throw new TypeError("Ledger must be an array of records");
  let previousHash = null;
  let runId = null;

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    validateEvidenceEvent(record);
    if (record.sequence !== index) throw new Error(`Ledger sequence mismatch at index ${index}`);
    if (index === 0) runId = record.run_id;
    if (record.run_id !== runId) throw new Error(`Ledger run_id changed at index ${index}`);
    if (record.prev_record_hash !== previousHash) throw new Error(`Ledger previous-hash link mismatch at index ${index}`);
    const expectedHash = computeEvidenceRecordHash(record);
    if (record.record_hash !== expectedHash) throw new Error(`Ledger record hash mismatch at index ${index}`);
    previousHash = record.record_hash;
  }

  return { valid: true, count: records.length, last_record_hash: previousHash };
}

export function parseLedgerJsonl(content) {
  if (typeof content !== "string") throw new TypeError("Ledger JSONL content must be a string");
  const lines = content.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  return lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid JSONL at line ${index + 1}: ${error.message}`);
    }
  });
}

export function canonicalLedgerDigest(records) {
  validateLedgerRecords(records);
  const substantive = records.map((record) => ({
    schema_version: record.schema_version,
    run_id: record.run_id,
    sequence: record.sequence,
    event_type: record.event_type,
    recorded_at_utc: "<wall-clock>",
    payload: record.payload,
  }));
  return sha256Hex(canonicalSerialize(substantive));
}

export class EvidenceLedgerWriter {
  constructor(filePath, runId, records, clock) {
    this.filePath = filePath;
    this.runId = runId;
    this.sequence = records.length;
    this.prevRecordHash = records.length === 0 ? null : records.at(-1).record_hash;
    this.clock = clock;
  }

  static async createNew(filePath, runId, { clock = () => new Date().toISOString() } = {}) {
    if (typeof runId !== "string" || runId.length === 0) throw new TypeError("runId must be a non-empty string");
    await writeFile(filePath, "", { encoding: "utf8", flag: "wx" });
    return new EvidenceLedgerWriter(filePath, runId, [], clock);
  }

  static async resume(filePath, { clock = () => new Date().toISOString() } = {}) {
    const content = await readFile(filePath, "utf8");
    const records = parseLedgerJsonl(content);
    if (records.length === 0) throw new Error("Cannot resume an empty ledger without an explicit run_id");
    validateLedgerRecords(records);
    return new EvidenceLedgerWriter(filePath, records[0].run_id, records, clock);
  }

  async append(event_type, payload, { recorded_at_utc = this.clock() } = {}) {
    const record = buildEvidenceRecord({
      run_id: this.runId,
      sequence: this.sequence,
      event_type,
      recorded_at_utc,
      payload,
      prev_record_hash: this.prevRecordHash,
    });
    await appendFile(this.filePath, `${canonicalSerialize(record)}\n`, { encoding: "utf8", flag: "a" });
    this.sequence += 1;
    this.prevRecordHash = record.record_hash;
    return record;
  }
}
