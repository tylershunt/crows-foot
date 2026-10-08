#!/usr/bin/env node
// Sets the app's version everywhere it is recorded and prints it.
//
// CHANGELOG.md gets a section for the new version. A section for the current
// version that was never tagged is renamed, notes and all.
//
//   node scripts/set-version.mjs 1.4.0
//   node scripts/set-version.mjs patch | minor | major

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(root + path, "utf8");
const write = (path, text) => writeFileSync(root + path, text);

const current = JSON.parse(read("package.json")).version;
const requested = process.argv[2];
const version = next(current, requested);

function next(from, how) {
  if (/^\d+\.\d+\.\d+$/.test(how ?? "")) return how;
  const [major, minor, patch] = from.split(".").map(Number);
  if (how === "patch") return `${major}.${minor}.${patch + 1}`;
  if (how === "minor") return `${major}.${minor + 1}.0`;
  if (how === "major") return `${major + 1}.0.0`;
  console.error("usage: set-version.mjs <x.y.z | patch | minor | major>");
  process.exit(2);
}

function replaceOnce(path, pattern, replacement) {
  const text = read(path);
  if (!pattern.test(text)) throw new Error(`${path} has no version matching ${pattern}`);
  write(path, text.replace(pattern, replacement));
}

for (const path of ["package.json", "src-tauri/tauri.conf.json"]) {
  replaceOnce(path, /("version":\s*)"[^"]+"/, `$1"${version}"`);
}

const lock = JSON.parse(read("package-lock.json"));
lock.version = version;
lock.packages[""].version = version;
write("package-lock.json", JSON.stringify(lock, null, 2) + "\n");

replaceOnce("src-tauri/Cargo.toml", /^version = "[^"]+"/m, `version = "${version}"`);
replaceOnce("src-tauri/Cargo.lock", /(name = "crows-foot"\nversion = )"[^"]+"/, `$1"${version}"`);

openChangelogSection();

function openChangelogSection() {
  const path = "CHANGELOG.md";
  const text = read(path);
  const heading = (v) => new RegExp(`^## ${v.replaceAll(".", "\\.")}$`, "m");
  if (heading(version).test(text)) return;
  const tagged = execFileSync("git", ["tag", "--list", `v${current}`], { cwd: root, encoding: "utf8" }).trim();
  if (!tagged && heading(current).test(text)) {
    write(path, text.replace(heading(current), `## ${version}`));
    return;
  }
  const first = text.search(/^## /m);
  if (first === -1) throw new Error(`${path} has no version sections`);
  write(path, `${text.slice(0, first)}## ${version}\n\n${text.slice(first)}`);
}

console.log(version);
