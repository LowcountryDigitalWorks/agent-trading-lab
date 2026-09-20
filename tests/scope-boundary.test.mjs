import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

async function sourceText() {
  const src = new URL("../src/", import.meta.url).pathname;
  const entries = await readdir(src, { withFileTypes: true });
  const chunks = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".mjs")) chunks.push(await readFile(join(src, entry.name), "utf8"));
  }
  return chunks.join("\n").toLowerCase();
}

test("Release 0.1 has no package dependencies", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
});

test("Release 0.1 source has no network, external-model, exchange, wallet, or deferred integration code path", async () => {
  const source = await sourceText();
  const forbidden = [
    "node:http",
    "node:https",
    "node:net",
    "node:tls",
    "fetch(",
    "websocket",
    "from \"freqtrade",
    "from \"predictionmarketbench",
    "from \"polybench",
    "from \"ccxt",
    "from \"ethers",
    "from \"viem",
    "private key",
    "wallet",
    "brokerage",
    "exchange api",
  ];
  for (const token of forbidden) assert.equal(source.includes(token), false, `Forbidden Release 0.1 source token found: ${token}`);
});
