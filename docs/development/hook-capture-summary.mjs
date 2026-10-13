#!/usr/bin/env node
// Summarises hook captures made with `avalok hook <tool> --capture`: for each kind of event, how
// many were seen and which fields they carried. Reads files only; prints structure and event
// names, never raw values from shape captures.
//
//   node docs/development/hook-capture-summary.mjs <capture.jsonl> [more.jsonl ...]
import { readFileSync } from "node:fs";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Usage: node docs/development/hook-capture-summary.mjs <capture.jsonl> ...");
  process.exit(2);
}

const eventKeys = ["hook_event_name", "hookEventName", "event", "event_name", "trigger", "type"];
const paths = (value, prefix = "", depth = 0) => {
  if (value === null || typeof value !== "object" || depth >= 4) return [prefix || "(value)"];
  const entries = Array.isArray(value)
    ? value.length > 0
      ? [["[]", value[0]]]
      : []
    : Object.entries(value);
  if (entries.length === 0) return [prefix || "(empty)"];
  return entries.flatMap(([key, inner]) =>
    paths(inner, prefix ? `${prefix}.${key}` : key, depth + 1),
  );
};

const groups = new Map();
let lines = 0;
let unreadable = 0;
for (const file of files) {
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    lines += 1;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      unreadable += 1;
      continue;
    }
    const payload = record.payload ?? {};
    // Shape captures spell an array as {"<array>": n, first: ...}; show it as `[]`.
    const flat = (value) =>
      value && typeof value === "object" && "<array>" in value ? { "[]": value.first } : value;
    const name =
      eventKeys.map((key) => payload[key]).find((value) => typeof value === "string") ??
      "(no event name field)";
    const key = `${record.tool}  ${name}`;
    const group = groups.get(key) ?? { count: 0, fields: new Set(), mode: record.mode };
    group.count += 1;
    const walk = (value, prefix = "", depth = 0) => {
      const inner = flat(value);
      if (inner === null || typeof inner !== "object" || depth >= 4) return [prefix || "(value)"];
      const entries = Object.entries(inner);
      if (entries.length === 0) return [prefix || "(empty)"];
      return entries.flatMap(([k, v]) => walk(v, prefix ? `${prefix}.${k}` : k, depth + 1));
    };
    for (const path of record.mode === "shape" ? walk(payload) : paths(payload))
      group.fields.add(path);
    groups.set(key, group);
  }
}

console.log(
  `${lines} captured event(s), ${groups.size} kind(s)${unreadable ? `, ${unreadable} unreadable line(s)` : ""}\n`,
);
for (const [key, group] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`${key}  x${group.count}  (${group.mode} capture)`);
  for (const field of [...group.fields].sort()) console.log(`    ${field}`);
  console.log("");
}
