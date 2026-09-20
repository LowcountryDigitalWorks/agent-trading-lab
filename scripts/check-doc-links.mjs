import { access, readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";

const rootPath = new URL("../", import.meta.url).pathname;
const ignoredDirectories = new Set([".git", "node_modules", "coverage"]);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (extname(entry.name) === ".md") files.push(path);
  }
  return files;
}

const failures = [];
const linkPattern = /\[[^\]]+\]\(([^)]+)\)/gu;
for (const file of await walk(rootPath)) {
  const content = await readFile(file, "utf8");
  for (const match of content.matchAll(linkPattern)) {
    const target = match[1].trim();
    if (/^(?:https?:|mailto:|#)/u.test(target)) continue;
    const cleanTarget = target.split("#", 1)[0];
    if (!cleanTarget) continue;
    const absolute = resolve(dirname(file), cleanTarget);
    try {
      await access(absolute);
    } catch {
      failures.push(`${relative(rootPath, file)} -> ${target}`);
    }
  }
}
if (failures.length > 0) {
  console.error(`Broken relative Markdown links:\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("documentation link check passed");
