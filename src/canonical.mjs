import { createHash } from "node:crypto";

function normalize(value, seen) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical serialization rejects non-finite numbers");
    }
    return Object.is(value, -0) ? 0 : value;
  }

  if (typeof value === "bigint" || typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
    throw new TypeError(`Canonical serialization rejects ${typeof value}`);
  }

  if (typeof value !== "object") {
    throw new TypeError("Unsupported canonical value");
  }

  if (seen.has(value)) {
    throw new TypeError("Canonical serialization rejects circular structures");
  }
  seen.add(value);

  try {
    if (Array.isArray(value)) {
      return value.map((item) => normalize(item, seen));
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Canonical serialization accepts only plain objects and arrays");
    }

    const output = {};
    for (const key of Object.keys(value).sort()) {
      output[key] = normalize(value[key], seen);
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

export function canonicalSerialize(value) {
  return JSON.stringify(normalize(value, new Set()));
}

export function sha256Hex(value) {
  const serialized = typeof value === "string" ? value : canonicalSerialize(value);
  return createHash("sha256").update(serialized, "utf8").digest("hex");
}

export function isSha256Hex(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}
