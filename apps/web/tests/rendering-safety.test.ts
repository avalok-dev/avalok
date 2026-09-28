import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Raw telemetry, Codex/Claude session content, and repository-derived strings are untrusted.
// The UI renders them only as React text (escaped). This guard keeps raw-HTML and dynamic-code
// sinks out of the dashboard and the shared UI package.

const roots = [
  resolve(import.meta.dirname, "../src"),
  resolve(import.meta.dirname, "../../../packages/ui/src"),
];
const forbidden = [
  /dangerouslySetInnerHTML/,
  /\.innerHTML\s*=/,
  /\.outerHTML\s*=/,
  /insertAdjacentHTML/,
  /document\.write/,
  /\beval\s*\(/,
  /new Function\s*\(/,
];

async function files(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory()
        ? files(join(directory, entry.name))
        : Promise.resolve(/\.(t|j)sx?$/.test(entry.name) ? [join(directory, entry.name)] : []),
    ),
  );
  return nested.flat();
}

describe("rendering safety", () => {
  it("has no raw-HTML or dynamic-code sinks for untrusted values", async () => {
    const offenders: string[] = [];
    for (const root of roots)
      for (const file of await files(root)) {
        const source = await readFile(file, "utf8");
        for (const pattern of forbidden)
          if (pattern.test(source)) offenders.push(`${file}: ${pattern}`);
      }
    expect(offenders).toEqual([]);
  });
});
