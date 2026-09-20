import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { canonicalSerialize, sha256Hex } from "./canonical.mjs";

export const PROOF_START_UTC = "2026-08-01T00:00:00.000Z";
export const PROOF_END_UTC = "2026-09-01T00:00:00.000Z";
export const PROOF_START_MS = Date.parse(PROOF_START_UTC);
export const PROOF_END_MS = Date.parse(PROOF_END_UTC);
export const PAIRS = Object.freeze(["BTC/USDT", "ETH/USDT"]);
export const TIMEFRAME_MS = Object.freeze({ "5m": 5 * 60 * 1000, "1h": 60 * 60 * 1000 });

function fail(message) {
  throw new TypeError(message);
}

function finite(value, label, { positive = false, nonNegative = false } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${label} must be finite`);
  if (positive && value <= 0) fail(`${label} must be > 0`);
  if (nonNegative && value < 0) fail(`${label} must be >= 0`);
  return value;
}

function integer(value, label) {
  if (!Number.isInteger(value)) fail(`${label} must be an integer`);
  return value;
}

function parseJsonArray(text, label) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
  if (!Array.isArray(parsed)) fail(`${label} must contain a JSON array`);
  return parsed;
}

function iso(ms) {
  return new Date(ms).toISOString();
}

function assertPair(pair) {
  if (!PAIRS.includes(pair)) fail(`unexpected pair: ${pair}`);
}

function assertWindow(startMs, endMs) {
  if (startMs !== PROOF_START_MS || endMs !== PROOF_END_MS) {
    fail(`unexpected proof window: ${iso(startMs)} through ${iso(endMs)}`);
  }
}

export function inspectCandleGaps(candles, timeframe) {
  const step = TIMEFRAME_MS[timeframe];
  if (!step) fail(`unsupported timeframe: ${timeframe}`);
  const gaps = [];
  for (let index = 1; index < candles.length; index += 1) {
    const delta = candles[index].timestamp_ms - candles[index - 1].timestamp_ms;
    if (delta > step) {
      gaps.push({
        after_utc: iso(candles[index - 1].timestamp_ms),
        before_utc: iso(candles[index].timestamp_ms),
        missing_buckets: delta / step - 1,
      });
    }
  }
  return gaps;
}

export function parseFreqtradeOhlcvJson(text, { pair, timeframe, startMs = PROOF_START_MS, endMs = PROOF_END_MS } = {}) {
  assertPair(pair);
  assertWindow(startMs, endMs);
  const step = TIMEFRAME_MS[timeframe];
  if (!step) fail(`unsupported timeframe: ${timeframe}`);
  const rows = parseJsonArray(text, `${pair} ${timeframe} OHLCV`);
  const candles = [];
  let previous = null;
  let rawEarliest = null;
  let rawLatest = null;
  let excludedBeforeWindow = 0;
  let excludedAfterWindow = 0;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!Array.isArray(row) || row.length !== 6) fail(`${pair} ${timeframe} row ${index} must have exactly 6 positional values`);
    const [timestamp, open, high, low, close, volume] = row;
    integer(timestamp, `${pair} ${timeframe} row ${index} timestamp`);
    if (timestamp % step !== 0) fail(`${pair} ${timeframe} row ${index} timestamp is not aligned to timeframe`);
    if (previous !== null && timestamp <= previous) {
      if (timestamp === previous) fail(`${pair} ${timeframe} duplicate candle timestamp at ${iso(timestamp)}`);
      fail(`${pair} ${timeframe} timestamps are not strictly increasing`);
    }
    finite(open, `${pair} ${timeframe} open`, { positive: true });
    finite(high, `${pair} ${timeframe} high`, { positive: true });
    finite(low, `${pair} ${timeframe} low`, { positive: true });
    finite(close, `${pair} ${timeframe} close`, { positive: true });
    finite(volume, `${pair} ${timeframe} volume`, { nonNegative: true });
    if (high < Math.max(open, close, low) || low > Math.min(open, close, high)) fail(`${pair} ${timeframe} row ${index} has inconsistent OHLC values`);

    rawEarliest ??= timestamp;
    rawLatest = timestamp;
    if (timestamp < startMs) excludedBeforeWindow += 1;
    else if (timestamp >= endMs) excludedAfterWindow += 1;
    else candles.push({ timestamp_ms: timestamp, open, high, low, close, base_volume: volume });

    previous = timestamp;
  }

  if (rows.length === 0) fail(`${pair} ${timeframe} artifact is empty`);
  if (candles.length === 0) fail(`${pair} ${timeframe} artifact contains no rows in the frozen proof window`);

  return {
    pair,
    timeframe,
    candles,
    diagnostics: {
      raw_count: rows.length,
      raw_earliest_utc: iso(rawEarliest),
      raw_latest_utc: iso(rawLatest),
      excluded_before_window: excludedBeforeWindow,
      excluded_after_window: excludedAfterWindow,
      count: candles.length,
      earliest_utc: iso(candles[0].timestamp_ms),
      latest_utc: iso(candles.at(-1).timestamp_ms),
      duplicate_timestamps: 0,
      gaps: inspectCandleGaps(candles, timeframe),
    },
  };
}

export function parseFreqtradeTradesJson(text, { pair, startMs = PROOF_START_MS, endMs = PROOF_END_MS } = {}) {
  assertPair(pair);
  assertWindow(startMs, endMs);
  const rows = parseJsonArray(text, `${pair} trades`);
  const trades = [];
  const ids = new Set();
  let previous = null;
  let rawEarliest = null;
  let rawLatest = null;
  let excludedBeforeWindow = 0;
  let excludedAfterWindow = 0;
  let sameTimestampTrades = 0;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!Array.isArray(row) || row.length !== 7) fail(`${pair} trade row ${index} must have exactly 7 positional values`);
    const [timestamp, id, type, side, price, amount, suppliedCost] = row;
    integer(timestamp, `${pair} trade row ${index} timestamp`);
    if (previous !== null && timestamp < previous) fail(`${pair} trade timestamps are not nondecreasing`);
    if (previous === timestamp) sameTimestampTrades += 1;

    const idKey = String(id);
    if (idKey.length === 0) fail(`${pair} trade row ${index} has an empty id`);
    if (ids.has(idKey)) fail(`${pair} duplicate trade id: ${idKey}`);
    ids.add(idKey);

    if (!(type === null || typeof type === "string")) fail(`${pair} trade row ${index} type must be string or null`);
    if (!(side === null || typeof side === "string")) fail(`${pair} trade row ${index} side must be string or null`);
    finite(price, `${pair} trade row ${index} price`, { positive: true });
    finite(amount, `${pair} trade row ${index} amount`, { positive: true });
    finite(suppliedCost, `${pair} trade row ${index} cost`, { nonNegative: true });

    const quoteCost = price * amount;
    finite(quoteCost, `${pair} trade row ${index} derived quote cost`, { positive: true });

    rawEarliest ??= timestamp;
    rawLatest = timestamp;
    if (timestamp < startMs) excludedBeforeWindow += 1;
    else if (timestamp >= endMs) excludedAfterWindow += 1;
    else trades.push({ timestamp_ms: timestamp, id: idKey, type, side, price, amount, quote_cost: quoteCost, supplied_cost: suppliedCost });

    previous = timestamp;
  }

  if (rows.length === 0) fail(`${pair} trades artifact is empty`);
  if (trades.length === 0) fail(`${pair} trades artifact contains no rows in the frozen proof window`);

  return {
    pair,
    trades,
    diagnostics: {
      raw_count: rows.length,
      raw_earliest_utc: iso(rawEarliest),
      raw_latest_utc: iso(rawLatest),
      excluded_before_window: excludedBeforeWindow,
      excluded_after_window: excludedAfterWindow,
      count: trades.length,
      earliest_utc: iso(trades[0].timestamp_ms),
      latest_utc: iso(trades.at(-1).timestamp_ms),
      duplicate_trade_ids: 0,
      same_timestamp_trade_rows: sameTimestampTrades,
    },
  };
}

export function deriveQuoteVolume5m(trades) {
  const step = TIMEFRAME_MS["5m"];
  const quoteVolumeByTimestamp = new Map();
  for (const trade of trades) {
    const bucket = Math.floor(trade.timestamp_ms / step) * step;
    quoteVolumeByTimestamp.set(bucket, (quoteVolumeByTimestamp.get(bucket) ?? 0) + trade.price * trade.amount);
  }
  const rows = [...quoteVolumeByTimestamp.entries()]
    .sort(([left], [right]) => left - right)
    .map(([timestamp_ms, quote_volume]) => ({ timestamp_ms, quote_volume }));
  return {
    rows,
    provenance: {
      method: "sum(price * amount) from Freqtrade public trade artifact",
      timeframe: "5m",
    },
    digest: sha256Hex(canonicalSerialize(rows)),
  };
}

function pairStem(pair) {
  return pair.replace("/", "_").replace(":", "_");
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function findExactlyOne(files, expectedName) {
  const matches = files.filter((path) => basename(path) === expectedName);
  if (matches.length !== 1) fail(`expected exactly one ${expectedName}, found ${matches.length}`);
  return matches[0];
}

export async function loadFreqtradeProofArtifacts(dataDirectory) {
  const files = await walk(dataDirectory);
  const datasets = {};
  const rawInputs = [];
  const derivedArtifacts = [];
  const diagnostics = {};
  for (const pair of PAIRS) {
    const stem = pairStem(pair);
    const tradePath = findExactlyOne(files, `${stem}-trades.json`);
    const fivePath = findExactlyOne(files, `${stem}-5m.json`);
    const hourPath = findExactlyOne(files, `${stem}-1h.json`);
    const [tradeText, fiveText, hourText] = await Promise.all([
      readFile(tradePath, "utf8"),
      readFile(fivePath, "utf8"),
      readFile(hourPath, "utf8"),
    ]);
    const tradeHash = sha256Hex(tradeText);
    const fiveHash = sha256Hex(fiveText);
    const hourHash = sha256Hex(hourText);
    rawInputs.push(
      { name: basename(tradePath), sha256: tradeHash },
      { name: basename(fivePath), sha256: fiveHash },
      { name: basename(hourPath), sha256: hourHash },
    );
    const trades = parseFreqtradeTradesJson(tradeText, { pair });
    const five = parseFreqtradeOhlcvJson(fiveText, { pair, timeframe: "5m" });
    const hour = parseFreqtradeOhlcvJson(hourText, { pair, timeframe: "1h" });
    const quote = deriveQuoteVolume5m(trades.trades);
    const normalizedFiveHash = sha256Hex(canonicalSerialize(five.candles));
    const normalizedHourHash = sha256Hex(canonicalSerialize(hour.candles));
    derivedArtifacts.push(
      { name: `${stem}-5m.normalized`, sha256: normalizedFiveHash, parent_hashes: [fiveHash] },
      { name: `${stem}-1h.normalized`, sha256: normalizedHourHash, parent_hashes: [hourHash] },
      { name: `${stem}-5m.quote-volume`, sha256: quote.digest, parent_hashes: [tradeHash] },
    );
    datasets[pair] = {
      trades: trades.trades,
      candles5m: five.candles,
      candles1h: hour.candles,
      quoteVolume5m: new Map(quote.rows.map((row) => [row.timestamp_ms, row.quote_volume])),
      hashes: { raw_trades: tradeHash, raw_5m: fiveHash, raw_1h: hourHash, normalized_5m: normalizedFiveHash, normalized_1h: normalizedHourHash, quote_volume_5m: quote.digest },
    };
    diagnostics[pair] = { trades: trades.diagnostics, "5m": five.diagnostics, "1h": hour.diagnostics, quote_volume_bucket_count: quote.rows.length };
  }
  rawInputs.sort((a, b) => a.name.localeCompare(b.name));
  derivedArtifacts.sort((a, b) => a.name.localeCompare(b.name));
  return { datasets, rawInputs, derivedArtifacts, diagnostics };
}
