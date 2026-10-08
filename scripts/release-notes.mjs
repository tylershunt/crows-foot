#!/usr/bin/env node
// Prints the CHANGELOG.md section for a version, and fails when it is missing
// or empty.
//
//   node scripts/release-notes.mjs 1.4.0

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const version = process.argv[2];
if (!version) {
  console.error("usage: release-notes.mjs <x.y.z>");
  process.exit(2);
}

const changelog = readFileSync(fileURLToPath(new URL("../CHANGELOG.md", import.meta.url)), "utf8");
const notes = section(changelog, version);
if (!notes) {
  console.error(`CHANGELOG.md has no notes under "## ${version}"`);
  process.exit(1);
}
console.log(notes);

/** The text between `## <version>` and the next `## ` heading, trimmed. */
function section(text, wanted) {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${wanted}`);
  if (start === -1) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
}
