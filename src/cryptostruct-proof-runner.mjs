import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { canonicalSerialize, isSha256Hex, sha256Hex } from "./canonical.mjs";
import {
  CRYPTOSTRUCT_ALLOWED_TOOLS,
  CRYPTOSTRUCT_MCP_ENDPOINT,
  cryptoStructSourceContractHash,
  parseGetInstrumentResult,
  parseGetMarketSnapshotResult,
  parseMcpToolEnvelope,
  parseSearchInstrumentsResult,
} from "./cryptostruct-source.mjs";

export const PROOF_CALL_TERMINAL_STATUSES = Object.freeze([
  "SUCCESS",
  "HTTP_ERROR",
  "MCP_ERROR",
  "TIMEOUT",
  "PARSE_ERROR",
  "RUNNER_ABORTED_AFTER_RESERVATION",
]);

export const PROOF_CLASSIFICATIONS = Object.freeze([
  "QUALIFIED",
  "INSUFFICIENT",
  "BLOCKED",
]);

export const PROOF_CALL_RECORD_TYPES = Object.freeze([
  "CALL_RESERVED",
  "CALL_DISPATCHED",
  "CALL_TERMINAL",
]);

const CALL_RECORD_FIELDS = Object.freeze([
  "schema_version",
  "proof_run_id",
  "record_sequence",
  "record_type",
  "call_sequence",
  "tool",
  "sanitized_argument_hash",
  "instrument_id",
  "reservation_timestamp",
  "dispatch_timestamp",
  "completion_timestamp",
  "terminal_status",
  "terminal_reason_code",
  "http_status",
  "response_content_hash",
  "source_schema_fingerprint",
  "candidate_hashes",
  "previous_record_hash",
  "record_hash",
]);

const MANIFEST_FIELDS = Object.freeze([
  "schema_version",
  "proof_run_id",
  "source_contract_hash",
  "runner_commit",
  "runner_version",
  "started_at",
  "ended_at",
  "max_attempted_calls",
  "max_unique_candidates",
  "per_call_timeout_ms",
  "whole_proof_timeout_ms",
  "discovery_plan_hash",
  "selector_config_hash",
  "total_reserved_attempts",
  "terminal_status_counts",
  "unique_candidate_count",
  "classification",
  "ledger_final_hash",
  "artifact_hash",
]);

function assert(condition, message) {
  if (!condition) throw new TypeError(message);
}

function plain(value, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value;
}

function closedKeys(value, allowed, label) {
  plain(value, label);
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    assert(allowedSet.has(key), `${label} contains unknown field: ${key}`);
  }
}

function nonEmpty(value, label) {
  assert(typeof value === "string" && value.length > 0, `${label} must be a non-empty string`);
  return value;
}

function nullableNonEmpty(value, label) {
  assert(value === null || (typeof value === "string" && value.length > 0), `${label} must be null or a non-empty string`);
  return value;
}

function isoUtc(value, label) {
  nonEmpty(value, label);
  assert(value.endsWith("Z") && !Number.isNaN(Date.parse(value)), `${label} must be ISO-8601 UTC`);
  return value;
}

function nullableIsoUtc(value, label) {
  if (value === null) return value;
  return isoUtc(value, label);
}

function positiveInteger(value, label) {
  assert(Number.isInteger(value) && value > 0, `${label} must be a positive integer`);
  return value;
}

function nonNegativeInteger(value, label) {
  assert(Number.isInteger(value) && value >= 0, `${label} must be a non-negative integer`);
  return value;
}

function nullableHttpStatus(value) {
  assert(value === null || (Number.isInteger(value) && value >= 100 && value <= 599), "http_status must be null or a valid HTTP status");
  return value;
}

function nullableSha(value, label) {
  assert(value === null || isSha256Hex(value), `${label} must be null or SHA-256 hex`);
  return value;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function withoutRecordHash(record) {
  const { record_hash: _recordHash, ...material } = record;
  return material;
}

export function computeProofCallRecordHash(record) {
  return sha256Hex(canonicalSerialize(withoutRecordHash(record)));
}

export function validateProofCallRecord(record) {
  closedKeys(record, CALL_RECORD_FIELDS, "ProofCallRecord");
  assert(record.schema_version === "cryptostruct-proof-call-record.v1", "ProofCallRecord schema_version mismatch");
  nonEmpty(record.proof_run_id, "ProofCallRecord.proof_run_id");
  nonNegativeInteger(record.record_sequence, "ProofCallRecord.record_sequence");
  assert(PROOF_CALL_RECORD_TYPES.includes(record.record_type), "ProofCallRecord record_type is invalid");
  positiveInteger(record.call_sequence, "ProofCallRecord.call_sequence");
  assert(CRYPTOSTRUCT_ALLOWED_TOOLS.includes(record.tool), "ProofCallRecord tool is not permitted");
  assert(isSha256Hex(record.sanitized_argument_hash), "ProofCallRecord sanitized_argument_hash must be SHA-256 hex");
  nullableNonEmpty(record.instrument_id, "ProofCallRecord.instrument_id");
  isoUtc(record.reservation_timestamp, "ProofCallRecord.reservation_timestamp");
  nullableIsoUtc(record.dispatch_timestamp, "ProofCallRecord.dispatch_timestamp");
  nullableIsoUtc(record.completion_timestamp, "ProofCallRecord.completion_timestamp");
  nullableNonEmpty(record.terminal_reason_code, "ProofCallRecord.terminal_reason_code");
  nullableHttpStatus(record.http_status);
  nullableSha(record.response_content_hash, "ProofCallRecord.response_content_hash");
  nullableSha(record.source_schema_fingerprint, "ProofCallRecord.source_schema_fingerprint");
  assert(Array.isArray(record.candidate_hashes), "ProofCallRecord candidate_hashes must be an array");
  const sortedCandidates = [...record.candidate_hashes].sort();
  assert(record.candidate_hashes.every(isSha256Hex), "ProofCallRecord candidate_hashes must contain SHA-256 hex");
  assert(new Set(record.candidate_hashes).size === record.candidate_hashes.length, "ProofCallRecord candidate_hashes must be unique");
  assert(canonicalSerialize(record.candidate_hashes) === canonicalSerialize(sortedCandidates), "ProofCallRecord candidate_hashes must be sorted");
  nullableSha(record.previous_record_hash, "ProofCallRecord.previous_record_hash");
  assert(isSha256Hex(record.record_hash), "ProofCallRecord record_hash must be SHA-256 hex");

  if (record.record_type === "CALL_RESERVED") {
    assert(record.dispatch_timestamp === null, "CALL_RESERVED dispatch_timestamp must be null");
    assert(record.completion_timestamp === null, "CALL_RESERVED completion_timestamp must be null");
    assert(record.terminal_status === null, "CALL_RESERVED terminal_status must be null");
    assert(record.terminal_reason_code === null, "CALL_RESERVED terminal_reason_code must be null");
    assert(record.http_status === null, "CALL_RESERVED http_status must be null");
    assert(record.response_content_hash === null, "CALL_RESERVED response_content_hash must be null");
    assert(record.source_schema_fingerprint === null, "CALL_RESERVED source_schema_fingerprint must be null");
    assert(record.candidate_hashes.length === 0, "CALL_RESERVED candidate_hashes must be empty");
  } else if (record.record_type === "CALL_DISPATCHED") {
    isoUtc(record.dispatch_timestamp, "CALL_DISPATCHED dispatch_timestamp");
    assert(record.completion_timestamp === null, "CALL_DISPATCHED completion_timestamp must be null");
    assert(record.terminal_status === null, "CALL_DISPATCHED terminal_status must be null");
    assert(record.terminal_reason_code === null, "CALL_DISPATCHED terminal_reason_code must be null");
    assert(record.http_status === null, "CALL_DISPATCHED http_status must be null");
    assert(record.response_content_hash === null, "CALL_DISPATCHED response_content_hash must be null");
    assert(record.source_schema_fingerprint === null, "CALL_DISPATCHED source_schema_fingerprint must be null");
    assert(record.candidate_hashes.length === 0, "CALL_DISPATCHED candidate_hashes must be empty");
  } else {
    assert(PROOF_CALL_TERMINAL_STATUSES.includes(record.terminal_status), "CALL_TERMINAL terminal_status is invalid");
    isoUtc(record.completion_timestamp, "CALL_TERMINAL completion_timestamp");
    if (record.terminal_status !== "RUNNER_ABORTED_AFTER_RESERVATION") {
      isoUtc(record.dispatch_timestamp, "CALL_TERMINAL dispatch_timestamp");
    }
  }

  assert(record.record_hash === computeProofCallRecordHash(record), "ProofCallRecord record_hash mismatch");
  return record;
}

export function parseProofCallLedgerJsonl(content) {
  assert(typeof content === "string", "proof-call ledger content must be a string");
  const lines = content.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  return lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid proof-call ledger JSONL at line ${index + 1}: ${error.message}`);
    }
  });
}

export function validateProofCallLedger(records, { requireTerminalForEveryReservation = false } = {}) {
  assert(Array.isArray(records), "proof-call ledger must be an array");
  let proofRunId = null;
  let previousRecordHash = null;
  let expectedReservationSequence = 1;
  const callStates = new Map();
  const candidateHashes = new Set();

  for (let index = 0; index < records.length; index += 1) {
    const record = validateProofCallRecord(records[index]);
    assert(record.record_sequence === index, `proof-call record_sequence mismatch at index ${index}`);
    if (index === 0) proofRunId = record.proof_run_id;
    assert(record.proof_run_id === proofRunId, `proof_run_id changed at index ${index}`);
    assert(record.previous_record_hash === previousRecordHash, `proof-call previous hash mismatch at index ${index}`);

    let state = callStates.get(record.call_sequence);
    if (record.record_type === "CALL_RESERVED") {
      assert(state === undefined, `call_sequence ${record.call_sequence} was reused`);
      assert(record.call_sequence === expectedReservationSequence, `call_sequence must be monotonic; expected ${expectedReservationSequence}`);
      expectedReservationSequence += 1;
      state = {
        reserved: record,
        dispatched: null,
        terminal: null,
      };
      callStates.set(record.call_sequence, state);
    } else {
      assert(state !== undefined, `call_sequence ${record.call_sequence} has no reservation`);
      assert(record.tool === state.reserved.tool, `call_sequence ${record.call_sequence} tool changed`);
      assert(record.sanitized_argument_hash === state.reserved.sanitized_argument_hash, `call_sequence ${record.call_sequence} argument hash changed`);
      assert(record.instrument_id === state.reserved.instrument_id, `call_sequence ${record.call_sequence} instrument_id changed`);
      assert(record.reservation_timestamp === state.reserved.reservation_timestamp, `call_sequence ${record.call_sequence} reservation timestamp changed`);

      if (record.record_type === "CALL_DISPATCHED") {
        assert(state.dispatched === null, `call_sequence ${record.call_sequence} was dispatched more than once`);
        assert(state.terminal === null, `call_sequence ${record.call_sequence} dispatched after terminal state`);
        state.dispatched = record;
      } else {
        assert(state.terminal === null, `call_sequence ${record.call_sequence} has more than one terminal state`);
        if (state.dispatched !== null) {
          assert(record.dispatch_timestamp === state.dispatched.dispatch_timestamp, `call_sequence ${record.call_sequence} dispatch timestamp changed`);
        } else {
          assert(
            record.terminal_status === "RUNNER_ABORTED_AFTER_RESERVATION" && record.dispatch_timestamp === null,
            `call_sequence ${record.call_sequence} terminal state requires a dispatch record`,
          );
        }
        state.terminal = record;
        for (const candidateHash of record.candidate_hashes) candidateHashes.add(candidateHash);
      }
    }
    previousRecordHash = record.record_hash;
  }

  if (requireTerminalForEveryReservation) {
    for (const [callSequence, state] of callStates.entries()) {
      assert(state.terminal !== null, `call_sequence ${callSequence} is missing a terminal state`);
    }
  }

  const terminalStatusCounts = Object.fromEntries(PROOF_CALL_TERMINAL_STATUSES.map((status) => [status, 0]));
  for (const state of callStates.values()) {
    if (state.terminal !== null) terminalStatusCounts[state.terminal.terminal_status] += 1;
  }

  return {
    valid: true,
    proof_run_id: proofRunId,
    record_count: records.length,
    total_reserved_attempts: callStates.size,
    terminal_status_counts: terminalStatusCounts,
    unique_candidate_count: candidateHashes.size,
    candidate_hashes: [...candidateHashes].sort(),
    call_states: callStates,
    last_record_hash: previousRecordHash,
  };
}

async function durableAppendLine(filePath, line) {
  const handle = await open(filePath, "a");
  try {
    await handle.appendFile(line, { encoding: "utf8" });
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function durableCreateEmpty(filePath) {
  await mkdir(dirname(filePath), { recursive: true });
  const handle = await open(filePath, "wx");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function durableWriteJson(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  const handle = await open(temporary, "w");
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, filePath);
}

function buildCallRecord({
  proof_run_id,
  record_sequence,
  record_type,
  call_sequence,
  tool,
  sanitized_argument_hash,
  instrument_id,
  reservation_timestamp,
  dispatch_timestamp,
  completion_timestamp,
  terminal_status,
  terminal_reason_code,
  http_status,
  response_content_hash,
  source_schema_fingerprint,
  candidate_hashes,
  previous_record_hash,
}) {
  const record = {
    schema_version: "cryptostruct-proof-call-record.v1",
    proof_run_id,
    record_sequence,
    record_type,
    call_sequence,
    tool,
    sanitized_argument_hash,
    instrument_id,
    reservation_timestamp,
    dispatch_timestamp,
    completion_timestamp,
    terminal_status,
    terminal_reason_code,
    http_status,
    response_content_hash,
    source_schema_fingerprint,
    candidate_hashes: [...candidate_hashes].sort(),
    previous_record_hash,
    record_hash: "0".repeat(64),
  };
  record.record_hash = computeProofCallRecordHash(record);
  validateProofCallRecord(record);
  return record;
}

export class DurableProofCallLedger {
  constructor(filePath, proofRunId, records, clock) {
    this.filePath = filePath;
    this.proofRunId = proofRunId;
    this.records = records;
    this.clock = clock;
    this.recordSequence = records.length;
    this.previousRecordHash = records.length === 0 ? null : records.at(-1).record_hash;
  }

  static async createNew(filePath, proofRunId, { clock = () => new Date().toISOString() } = {}) {
    nonEmpty(proofRunId, "proofRunId");
    await durableCreateEmpty(filePath);
    return new DurableProofCallLedger(filePath, proofRunId, [], clock);
  }

  static async resume(
    filePath,
    { clock = () => new Date().toISOString(), proofRunId = null } = {},
  ) {
    const content = await readFile(filePath, "utf8");
    const records = parseProofCallLedgerJsonl(content);
    if (records.length === 0) {
      nonEmpty(proofRunId, "proofRunId");
      return new DurableProofCallLedger(filePath, proofRunId, [], clock);
    }
    const validation = validateProofCallLedger(records);
    if (proofRunId !== null) {
      assert(validation.proof_run_id === proofRunId, "proofRunId does not match ledger");
    }
    return new DurableProofCallLedger(filePath, validation.proof_run_id, records, clock);
  }

  async append(material) {
    const record = buildCallRecord({
      ...material,
      proof_run_id: this.proofRunId,
      record_sequence: this.recordSequence,
      previous_record_hash: this.previousRecordHash,
    });
    validateProofCallLedger([...this.records, record]);
    await durableAppendLine(this.filePath, `${canonicalSerialize(record)}\n`);
    this.records.push(record);
    this.recordSequence += 1;
    this.previousRecordHash = record.record_hash;
    return record;
  }

  async reserve({ call_sequence, tool, sanitized_argument_hash, instrument_id, reservation_timestamp = this.clock() }) {
    return this.append({
      record_type: "CALL_RESERVED",
      call_sequence,
      tool,
      sanitized_argument_hash,
      instrument_id,
      reservation_timestamp,
      dispatch_timestamp: null,
      completion_timestamp: null,
      terminal_status: null,
      terminal_reason_code: null,
      http_status: null,
      response_content_hash: null,
      source_schema_fingerprint: null,
      candidate_hashes: [],
    });
  }

  async markDispatched(reservation, { dispatch_timestamp = this.clock() } = {}) {
    return this.append({
      record_type: "CALL_DISPATCHED",
      call_sequence: reservation.call_sequence,
      tool: reservation.tool,
      sanitized_argument_hash: reservation.sanitized_argument_hash,
      instrument_id: reservation.instrument_id,
      reservation_timestamp: reservation.reservation_timestamp,
      dispatch_timestamp,
      completion_timestamp: null,
      terminal_status: null,
      terminal_reason_code: null,
      http_status: null,
      response_content_hash: null,
      source_schema_fingerprint: null,
      candidate_hashes: [],
    });
  }

  async terminal(
    reservation,
    {
      dispatch_timestamp = null,
      completion_timestamp = this.clock(),
      terminal_status,
      terminal_reason_code = null,
      http_status = null,
      response_content_hash = null,
      source_schema_fingerprint = null,
      candidate_hashes = [],
    },
  ) {
    return this.append({
      record_type: "CALL_TERMINAL",
      call_sequence: reservation.call_sequence,
      tool: reservation.tool,
      sanitized_argument_hash: reservation.sanitized_argument_hash,
      instrument_id: reservation.instrument_id,
      reservation_timestamp: reservation.reservation_timestamp,
      dispatch_timestamp,
      completion_timestamp,
      terminal_status,
      terminal_reason_code,
      http_status,
      response_content_hash,
      source_schema_fingerprint,
      candidate_hashes,
    });
  }

  snapshot({ requireTerminalForEveryReservation = false } = {}) {
    return validateProofCallLedger(this.records, { requireTerminalForEveryReservation });
  }

  async reconcileOutstandingReservations({ completion_timestamp = this.clock() } = {}) {
    const initial = this.snapshot();
    let reconciled = 0;
    for (const state of initial.call_states.values()) {
      if (state.terminal !== null) continue;
      await this.terminal(state.reserved, {
        dispatch_timestamp: state.dispatched?.dispatch_timestamp ?? null,
        completion_timestamp,
        terminal_status: "RUNNER_ABORTED_AFTER_RESERVATION",
        terminal_reason_code: state.dispatched === null
          ? "runner_aborted_before_dispatch"
          : "runner_aborted_after_dispatch",
      });
      reconciled += 1;
    }
    return {
      reconciled,
      validation: this.snapshot({ requireTerminalForEveryReservation: true }),
    };
  }
}

function toolParser(tool) {
  if (tool === "search_instruments") return parseSearchInstrumentsResult;
  if (tool === "get_instrument") return parseGetInstrumentResult;
  if (tool === "get_market_snapshot") return parseGetMarketSnapshotResult;
  throw new TypeError(`unsupported CryptoStruct proof tool: ${tool}`);
}

function responseContentText(envelope) {
  const content = envelope?.result?.content;
  if (!Array.isArray(content)) return null;
  const textPart = content.find((part) => part?.type === "text" && typeof part.text === "string");
  return textPart?.text ?? null;
}

function candidateHashesFromSearch(parsed) {
  if (!parsed?.instruments) return [];
  return [...new Set(parsed.instruments.map((instrument) => sha256Hex(String(instrument.instrument_id))))].sort();
}

function normalizeInvokerResponse(value) {
  plain(value, "invokeTool response");
  const httpStatus = value.httpStatus ?? value.http_status;
  assert(Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599, "invokeTool response requires httpStatus");
  assert(typeof value.bodyText === "string", "invokeTool response requires bodyText string");
  return { httpStatus, bodyText: value.bodyText };
}

export async function invokeCryptoStructMcp({
  tool,
  args,
  signal,
  callSequence,
  fetchImpl = fetch,
  endpoint = CRYPTOSTRUCT_MCP_ENDPOINT,
}) {
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: callSequence,
      method: "tools/call",
      params: {
        name: tool,
        arguments: args,
      },
    }),
    signal,
  });
  return {
    httpStatus: response.status,
    bodyText: await response.text(),
  };
}

function validateFrozenRunnerConfig(config) {
  plain(config, "proof runner config");
  nonEmpty(config.proof_run_id, "proof_run_id");
  assert(isSha256Hex(config.source_contract_hash), "source_contract_hash must be SHA-256 hex");
  nonEmpty(config.runner_commit, "runner_commit");
  nonEmpty(config.runner_version, "runner_version");
  positiveInteger(config.max_attempted_calls, "max_attempted_calls");
  positiveInteger(config.max_unique_candidates, "max_unique_candidates");
  positiveInteger(config.per_call_timeout_ms, "per_call_timeout_ms");
  positiveInteger(config.whole_proof_timeout_ms, "whole_proof_timeout_ms");
  assert(
    config.whole_proof_timeout_ms > config.per_call_timeout_ms,
    "whole_proof_timeout_ms must exceed per_call_timeout_ms",
  );
  assert(Array.isArray(config.discovery_plan), "discovery_plan must be an array");
  plain(config.selector_config, "selector_config");
  isoUtc(config.started_at, "started_at");
  assert(isSha256Hex(config.discovery_plan_hash), "discovery_plan_hash must be SHA-256 hex");
  assert(isSha256Hex(config.selector_config_hash), "selector_config_hash must be SHA-256 hex");
  assert(isSha256Hex(config.config_hash), "config_hash must be SHA-256 hex");
  return config;
}

function frozenConfigMaterial(input, startedAt) {
  return {
    schema_version: "cryptostruct-proof-config.v1",
    proof_run_id: input.proof_run_id,
    source_contract_hash: input.source_contract_hash,
    runner_commit: input.runner_commit,
    runner_version: input.runner_version,
    max_attempted_calls: input.max_attempted_calls,
    max_unique_candidates: input.max_unique_candidates,
    per_call_timeout_ms: input.per_call_timeout_ms,
    whole_proof_timeout_ms: input.whole_proof_timeout_ms,
    discovery_plan: structuredClone(input.discovery_plan),
    selector_config: structuredClone(input.selector_config),
    discovery_plan_hash: sha256Hex(canonicalSerialize(input.discovery_plan)),
    selector_config_hash: sha256Hex(canonicalSerialize(input.selector_config)),
    started_at: startedAt,
  };
}

export function buildFrozenProofConfig(input, { startedAt = new Date().toISOString() } = {}) {
  const material = frozenConfigMaterial(input, startedAt);
  const config = {
    ...material,
    config_hash: sha256Hex(canonicalSerialize(material)),
  };
  validateFrozenRunnerConfig(config);
  return deepFreeze(config);
}

function configPaths(outputDir) {
  return {
    config: join(outputDir, ".proof-config.json"),
    ledger: join(outputDir, "sanitized-call-ledger.jsonl"),
    manifest: join(outputDir, "proof-manifest.json"),
    artifactHash: join(outputDir, "artifact-hash.txt"),
  };
}

async function loadFrozenConfig(outputDir) {
  const { config } = configPaths(outputDir);
  const parsed = JSON.parse(await readFile(config, "utf8"));
  validateFrozenRunnerConfig(parsed);
  const { config_hash, ...material } = parsed;
  assert(sha256Hex(canonicalSerialize(material)) === config_hash, "proof config hash mismatch");
  return deepFreeze(parsed);
}

export function validateProofManifest(manifest) {
  closedKeys(manifest, MANIFEST_FIELDS, "CryptoStructProofManifest");
  assert(manifest.schema_version === "cryptostruct-proof-manifest.v1", "manifest schema_version mismatch");
  nonEmpty(manifest.proof_run_id, "manifest.proof_run_id");
  assert(isSha256Hex(manifest.source_contract_hash), "manifest source_contract_hash must be SHA-256 hex");
  nonEmpty(manifest.runner_commit, "manifest.runner_commit");
  nonEmpty(manifest.runner_version, "manifest.runner_version");
  isoUtc(manifest.started_at, "manifest.started_at");
  isoUtc(manifest.ended_at, "manifest.ended_at");
  positiveInteger(manifest.max_attempted_calls, "manifest.max_attempted_calls");
  positiveInteger(manifest.max_unique_candidates, "manifest.max_unique_candidates");
  positiveInteger(manifest.per_call_timeout_ms, "manifest.per_call_timeout_ms");
  positiveInteger(manifest.whole_proof_timeout_ms, "manifest.whole_proof_timeout_ms");
  assert(isSha256Hex(manifest.discovery_plan_hash), "manifest discovery_plan_hash must be SHA-256 hex");
  assert(isSha256Hex(manifest.selector_config_hash), "manifest selector_config_hash must be SHA-256 hex");
  nonNegativeInteger(manifest.total_reserved_attempts, "manifest.total_reserved_attempts");
  closedKeys(manifest.terminal_status_counts, PROOF_CALL_TERMINAL_STATUSES, "manifest.terminal_status_counts");
  for (const status of PROOF_CALL_TERMINAL_STATUSES) {
    nonNegativeInteger(manifest.terminal_status_counts[status], `manifest.terminal_status_counts.${status}`);
  }
  nonNegativeInteger(manifest.unique_candidate_count, "manifest.unique_candidate_count");
  assert(PROOF_CLASSIFICATIONS.includes(manifest.classification), "manifest classification invalid");
  nullableSha(manifest.ledger_final_hash, "manifest.ledger_final_hash");
  assert(isSha256Hex(manifest.artifact_hash), "manifest artifact_hash must be SHA-256 hex");
  return manifest;
}

function artifactHashMaterial(manifestWithoutArtifactHash, records) {
  return {
    manifest: manifestWithoutArtifactHash,
    ledger_record_hashes: records.map((record) => record.record_hash),
  };
}

export async function finalizeProofArtifacts(
  outputDir,
  {
    classification = "BLOCKED",
    endedAt = new Date().toISOString(),
    clock = () => new Date().toISOString(),
  } = {},
) {
  assert(PROOF_CLASSIFICATIONS.includes(classification), "final classification must be QUALIFIED/INSUFFICIENT/BLOCKED");
  const paths = configPaths(outputDir);
  const config = await loadFrozenConfig(outputDir);

  let existingManifest = null;
  try {
    existingManifest = JSON.parse(await readFile(paths.manifest, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (existingManifest !== null) {
    validateProofManifest(existingManifest);
    const ledgerContent = await readFile(paths.ledger, "utf8");
    const records = parseProofCallLedgerJsonl(ledgerContent);
    const validation = validateProofCallLedger(records, { requireTerminalForEveryReservation: true });
    assert(existingManifest.ledger_final_hash === validation.last_record_hash, "existing manifest ledger_final_hash mismatch");
    return existingManifest;
  }

  const ledger = await DurableProofCallLedger.resume(paths.ledger, {
    clock,
    proofRunId: config.proof_run_id,
  });
  await ledger.reconcileOutstandingReservations({ completion_timestamp: endedAt });
  const validation = ledger.snapshot({ requireTerminalForEveryReservation: true });

  const withoutArtifactHash = {
    schema_version: "cryptostruct-proof-manifest.v1",
    proof_run_id: config.proof_run_id,
    source_contract_hash: config.source_contract_hash,
    runner_commit: config.runner_commit,
    runner_version: config.runner_version,
    started_at: config.started_at,
    ended_at: endedAt,
    max_attempted_calls: config.max_attempted_calls,
    max_unique_candidates: config.max_unique_candidates,
    per_call_timeout_ms: config.per_call_timeout_ms,
    whole_proof_timeout_ms: config.whole_proof_timeout_ms,
    discovery_plan_hash: config.discovery_plan_hash,
    selector_config_hash: config.selector_config_hash,
    total_reserved_attempts: validation.total_reserved_attempts,
    terminal_status_counts: validation.terminal_status_counts,
    unique_candidate_count: validation.unique_candidate_count,
    classification,
    ledger_final_hash: validation.last_record_hash,
  };
  const manifest = {
    ...withoutArtifactHash,
    artifact_hash: sha256Hex(canonicalSerialize(artifactHashMaterial(withoutArtifactHash, ledger.records))),
  };
  validateProofManifest(manifest);
  await durableWriteJson(paths.manifest, manifest);
  await writeFile(paths.artifactHash, `${manifest.artifact_hash}\n`, "utf8");
  return manifest;
}

export class ProofBudgetError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "ProofBudgetError";
    this.code = code;
  }
}

export class DeterministicCryptoStructProofRunner {
  constructor({ outputDir, config, ledger, invokeTool, clock, nowMs }) {
    this.outputDir = outputDir;
    this.config = config;
    this.ledger = ledger;
    this.invokeTool = invokeTool;
    this.clock = clock;
    this.nowMs = nowMs;
    this.startedEpochMs = Date.parse(config.started_at);
    this.closed = false;
  }

  static async create({
    outputDir,
    proof_run_id,
    source_contract_hash = cryptoStructSourceContractHash(),
    runner_commit,
    runner_version = "0.5.2",
    max_attempted_calls,
    max_unique_candidates,
    per_call_timeout_ms,
    whole_proof_timeout_ms,
    discovery_plan,
    selector_config,
    invokeTool = invokeCryptoStructMcp,
    clock = () => new Date().toISOString(),
    nowMs = () => Date.now(),
  }) {
    const startedAt = clock();
    const config = buildFrozenProofConfig(
      {
        proof_run_id,
        source_contract_hash,
        runner_commit,
        runner_version,
        max_attempted_calls,
        max_unique_candidates,
        per_call_timeout_ms,
        whole_proof_timeout_ms,
        discovery_plan,
        selector_config,
      },
      { startedAt },
    );
    const paths = configPaths(outputDir);
    await mkdir(outputDir, { recursive: true });
    await durableWriteJson(paths.config, config);
    const ledger = await DurableProofCallLedger.createNew(paths.ledger, proof_run_id, { clock });
    return new DeterministicCryptoStructProofRunner({
      outputDir,
      config,
      ledger,
      invokeTool,
      clock,
      nowMs,
    });
  }

  static async resume({
    outputDir,
    invokeTool = invokeCryptoStructMcp,
    clock = () => new Date().toISOString(),
    nowMs = () => Date.now(),
  }) {
    const config = await loadFrozenConfig(outputDir);
    const paths = configPaths(outputDir);
    const ledger = await DurableProofCallLedger.resume(paths.ledger, {
      clock,
      proofRunId: config.proof_run_id,
    });
    assert(ledger.proofRunId === config.proof_run_id, "proof config / ledger run ID mismatch");
    return new DeterministicCryptoStructProofRunner({
      outputDir,
      config,
      ledger,
      invokeTool,
      clock,
      nowMs,
    });
  }

  ledgerState() {
    return this.ledger.snapshot();
  }

  remainingAttemptCapacity() {
    return this.config.max_attempted_calls - this.ledgerState().total_reserved_attempts;
  }

  remainingCandidateCapacity() {
    return this.config.max_unique_candidates - this.ledgerState().unique_candidate_count;
  }

  candidateHashSet() {
    return new Set(this.ledgerState().candidate_hashes);
  }

  wholeProofRemainingMs() {
    return Math.max(0, this.config.whole_proof_timeout_ms - (this.nowMs() - this.startedEpochMs));
  }

  assertCanReserve(tool, args, instrumentId) {
    assert(!this.closed, "proof runner is closed");
    assert(CRYPTOSTRUCT_ALLOWED_TOOLS.includes(tool), `tool not allowed by frozen proof contract: ${tool}`);
    if (this.remainingAttemptCapacity() <= 0) {
      throw new ProofBudgetError("attempted-call budget exhausted", "ATTEMPT_BUDGET_EXHAUSTED");
    }
    if (this.wholeProofRemainingMs() <= 0) {
      throw new ProofBudgetError("whole-proof timeout exhausted", "WHOLE_PROOF_TIMEOUT");
    }

    if (tool === "search_instruments") {
      const limit = args?.limit;
      positiveInteger(limit, "search_instruments.limit");
      if (limit > this.remainingCandidateCapacity()) {
        throw new ProofBudgetError(
          "search_instruments limit exceeds remaining unique-candidate capacity",
          "UNIQUE_CANDIDATE_BUDGET_EXCEEDED",
        );
      }
    } else {
      nonEmpty(String(instrumentId ?? ""), "instrument_id");
      const candidateHash = sha256Hex(String(instrumentId));
      if (!this.candidateHashSet().has(candidateHash)) {
        throw new ProofBudgetError(
          "follow-on source call references an undiscovered candidate",
          "UNDISCOVERED_CANDIDATE",
        );
      }
    }
  }

  async reserveCall(tool, args, { instrumentId = null } = {}) {
    this.assertCanReserve(tool, args, instrumentId);
    const state = this.ledgerState();
    const callSequence = state.total_reserved_attempts + 1;
    const reservation = await this.ledger.reserve({
      call_sequence: callSequence,
      tool,
      sanitized_argument_hash: sha256Hex(canonicalSerialize(args)),
      instrument_id: instrumentId === null ? null : String(instrumentId),
      reservation_timestamp: this.clock(),
    });
    const after = this.ledgerState();
    assert(after.total_reserved_attempts === callSequence, "reserved attempt count did not advance exactly once");
    return reservation;
  }

  async executeCall(tool, args, { instrumentId = null } = {}) {
    const reservation = await this.reserveCall(tool, args, { instrumentId });
    const dispatch = await this.ledger.markDispatched(reservation, { dispatch_timestamp: this.clock() });

    const wholeRemaining = this.wholeProofRemainingMs();
    const timeoutMs = Math.min(this.config.per_call_timeout_ms, wholeRemaining);
    const timeoutReason = wholeRemaining <= this.config.per_call_timeout_ms
      ? "whole_proof_timeout"
      : "per_call_timeout";
    const controller = new AbortController();
    let timeoutHandle;

    const timeoutPromise = new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => {
        const error = new Error(timeoutReason);
        error.name = "ProofTimeoutError";
        controller.abort(error);
        reject(error);
      }, timeoutMs);
    });

    try {
      const invocation = Promise.resolve(this.invokeTool({
        tool,
        args,
        signal: controller.signal,
        callSequence: reservation.call_sequence,
      }));
      const rawResponse = normalizeInvokerResponse(await Promise.race([invocation, timeoutPromise]));
      clearTimeout(timeoutHandle);

      const responseContentHash = sha256Hex(rawResponse.bodyText);
      if (rawResponse.httpStatus < 200 || rawResponse.httpStatus >= 300) {
        const terminal = await this.ledger.terminal(reservation, {
          dispatch_timestamp: dispatch.dispatch_timestamp,
          completion_timestamp: this.clock(),
          terminal_status: "HTTP_ERROR",
          terminal_reason_code: "http_non_success",
          http_status: rawResponse.httpStatus,
          response_content_hash: responseContentHash,
        });
        return { terminal_status: terminal.terminal_status, terminal, parsed: null };
      }

      let envelope;
      try {
        envelope = JSON.parse(rawResponse.bodyText);
      } catch {
        const terminal = await this.ledger.terminal(reservation, {
          dispatch_timestamp: dispatch.dispatch_timestamp,
          completion_timestamp: this.clock(),
          terminal_status: "PARSE_ERROR",
          terminal_reason_code: "invalid_json_response",
          http_status: rawResponse.httpStatus,
          response_content_hash: responseContentHash,
        });
        return { terminal_status: terminal.terminal_status, terminal, parsed: null };
      }

      if (envelope?.error !== undefined) {
        const terminal = await this.ledger.terminal(reservation, {
          dispatch_timestamp: dispatch.dispatch_timestamp,
          completion_timestamp: this.clock(),
          terminal_status: "MCP_ERROR",
          terminal_reason_code: "mcp_error_response",
          http_status: rawResponse.httpStatus,
          response_content_hash: responseContentHash,
        });
        return { terminal_status: terminal.terminal_status, terminal, parsed: null };
      }

      try {
        const parsedPayload = parseMcpToolEnvelope(envelope, tool);
        const parsed = toolParser(tool)(parsedPayload);
        let candidateHashes = [];
        if (tool === "search_instruments") {
          assert(
            parsed.instruments.length <= args.limit,
            "search_instruments response exceeded requested candidate limit",
          );
          candidateHashes = candidateHashesFromSearch(parsed);
          const current = this.candidateHashSet();
          const newCandidateCount = candidateHashes.filter((hash) => !current.has(hash)).length;
          assert(
            newCandidateCount <= this.remainingCandidateCapacity(),
            "search_instruments response exceeded frozen unique-candidate budget",
          );
        }
        const terminal = await this.ledger.terminal(reservation, {
          dispatch_timestamp: dispatch.dispatch_timestamp,
          completion_timestamp: this.clock(),
          terminal_status: "SUCCESS",
          terminal_reason_code: null,
          http_status: rawResponse.httpStatus,
          response_content_hash: responseContentHash,
          source_schema_fingerprint: parsed.source_schema_fingerprint ?? null,
          candidate_hashes: candidateHashes,
        });
        return { terminal_status: terminal.terminal_status, terminal, parsed };
      } catch (error) {
        const contentText = responseContentText(envelope);
        const contentHash = contentText === null ? responseContentHash : sha256Hex(contentText);
        const terminal = await this.ledger.terminal(reservation, {
          dispatch_timestamp: dispatch.dispatch_timestamp,
          completion_timestamp: this.clock(),
          terminal_status: "PARSE_ERROR",
          terminal_reason_code: "source_contract_parse_error",
          http_status: rawResponse.httpStatus,
          response_content_hash: contentHash,
        });
        return {
          terminal_status: terminal.terminal_status,
          terminal,
          parsed: null,
          error,
        };
      }
    } catch (error) {
      clearTimeout(timeoutHandle);
      if (error?.name === "ProofTimeoutError" || controller.signal.aborted) {
        const terminal = await this.ledger.terminal(reservation, {
          dispatch_timestamp: dispatch.dispatch_timestamp,
          completion_timestamp: this.clock(),
          terminal_status: "TIMEOUT",
          terminal_reason_code: timeoutReason,
        });
        return { terminal_status: terminal.terminal_status, terminal, parsed: null };
      }
      const terminal = await this.ledger.terminal(reservation, {
        dispatch_timestamp: dispatch.dispatch_timestamp,
        completion_timestamp: this.clock(),
        terminal_status: "HTTP_ERROR",
        terminal_reason_code: "network_or_transport_error",
      });
      return {
        terminal_status: terminal.terminal_status,
        terminal,
        parsed: null,
        error,
      };
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    }
  }

  async reconcileOutstandingReservations() {
    return this.ledger.reconcileOutstandingReservations({ completion_timestamp: this.clock() });
  }

  close() {
    this.closed = true;
  }
}

export async function readProofArtifacts(outputDir) {
  const paths = configPaths(outputDir);
  const [config, ledgerContent] = await Promise.all([
    loadFrozenConfig(outputDir),
    readFile(paths.ledger, "utf8"),
  ]);
  const records = parseProofCallLedgerJsonl(ledgerContent);
  return {
    config,
    records,
    validation: validateProofCallLedger(records),
    paths,
  };
}
