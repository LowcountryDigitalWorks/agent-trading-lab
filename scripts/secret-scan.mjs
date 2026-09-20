import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const rootPath = new URL("../", import.meta.url).pathname;
const ignoredDirectories = new Set([".git", "node_modules", "coverage"]);
const ignoredFiles = new Set(["LICENSE"]);
const textExtensions = new Set([".md", ".mjs", ".json", ".yml", ".yaml", ".txt"]);
const patterns = [
  ["private key header", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/u],
  ["GitHub token", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/u],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/u],
  ["credential assignment", /\b(?:api[_-]?key|secret|password|token)\s*[=:]\s*["'][^"'\s]{12,}["']/iu],
];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (!ignoredFiles.has(entry.name) && textExtensions.has(extname(entry.name))) files.push(path);
  }
  return files;
}

const hits = [];
for (const file of await walk(rootPath)) {
  const content = await readFile(file, "utf8");
  for (const [name, pattern] of patterns) {
    if (pattern.test(content)) hits.push(`${relative(rootPath, file)}: ${name}`);
  }
}
if (hits.length > 0) {
  console.error(hits.join("\n"));
  process.exit(1);
}
console.log("secret scan passed");
