import { describe, expect, it } from "vitest";
import { diagnosticKey } from "@visual-system/ui";

describe("diagnosticKey", () => {
  it("is unique for diagnostics that share a code, file and line", () => {
    // The old key was `${code}-${line ?? index}`: two files with a problem on line 3 collided,
    // which React reported as "two children with the same key" on every render.
    const diagnostics = [
      { code: "source.python-syntax", file: "a.py", line: 3 },
      { code: "source.python-syntax", file: "b.py", line: 3 },
      { code: "source.python-syntax", file: "b.py", line: 3 },
      { code: "terraform.invalid" },
      { code: "terraform.invalid" },
    ];
    const keys = diagnostics.map((diagnostic, index) => diagnosticKey(diagnostic, index));
    expect(new Set(keys).size).toBe(diagnostics.length);
  });

  it("is stable for the same row", () => {
    const diagnostic = { code: "x", file: "f.py", line: 2 };
    expect(diagnosticKey(diagnostic, 4)).toBe(diagnosticKey(diagnostic, 4));
  });
});
