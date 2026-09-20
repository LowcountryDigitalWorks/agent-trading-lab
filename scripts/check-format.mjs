import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const root = new URL("../", import.meta.url);
const allowedExtensions = new Set([".md", ".mjs", ".json", ".yml", ".yaml"]);
const ignoredDirectories = new Set([".git", "node_modules", "coverage"]);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (allowedExtensions.has(extname(entry.name))) files.push(path);
  }
  return files;
}

const rootPath = root.pathname;
const failures = [];
for (const file of await walk(rootPath)) {
  const content = await readFile(file, "utf8");
  const label = relative(rootPath, file);
  if (content.includes("\r\n")) failures.push(`${label}: CRLF line endings`);
  if (!content.endsWith("\n")) failures.push(`${label}: missing final newline`);
  content.split("\n").forEach((line, index) => {
    if (/[ \t]+$/u.test(line)) failures.push(`${label}:${index + 1}: trailing whitespace`);
  });
  if (extname(file) === ".json") {
    try {
      JSON.parse(content);
    } catch (error) {
      failures.push(`${label}: invalid JSON: ${error.message}`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("format check passed");
