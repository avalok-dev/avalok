import { describe, expect, it } from "vitest";
import { hasPythonParseProblem, normalizeForSyntaxCheck } from "../src/python-parser";

// Ground truth for these snippets: each "valid" one was confirmed with Python 3.14's own
// `ast.parse`. @lezer/python 1.1.19 (the latest release) cannot parse some of them.

describe("python parser gaps are not reported as problems in the user's code", () => {
  it.each([
    ["float with a trailing dot", "x = 2.\ny = 1. / 3\nz = (a + 1.) * 2."],
    ["decorator with an arbitrary expression", "@app.routes[0](1)\ndef handler():\n    pass"],
    ["t-string", 'name = "x"\ngreeting = t"hello {name}"'],
  ])("%s", (_name, source) => {
    expect(hasPythonParseProblem(`${source}\n`)).toBe(false);
  });
});

describe("real syntax problems are still reported", () => {
  it.each([
    ["unclosed call", "from fastapi import FastAPI\napp = FastAPI(\n"],
    ["bad parameter list", "def f(:\n    pass\n"],
    ["double operator", "x = = 1\n"],
    ["broken after a workaround case", "x = 2.\nprint(\n"],
  ])("%s", (_name, source) => {
    expect(hasPythonParseProblem(source)).toBe(true);
  });
});

describe("known remaining parser limits (valid Python 3.10+ that Lezer still rejects)", () => {
  // If a future @lezer/python release fixes these, these expectations will flip; update them
  // and the list in normalizeForSyntaxCheck's comment together.
  it("parenthesized with-items are still reported as parser-limited", () => {
    expect(hasPythonParseProblem("with (open('a') as f, open('b') as g):\n    pass\n")).toBe(true);
  });
  it("a star in a subscript is still reported as parser-limited", () => {
    expect(hasPythonParseProblem("x = a[*b]\n")).toBe(true);
  });
});

describe("normalizeForSyntaxCheck", () => {
  it("never changes offsets, so error positions stay valid", () => {
    const source = 'x = 2.\n@a.b[0](1)\ny = t"hi"\nz = 3.14 + a.b + 1.5e3\n';
    expect(normalizeForSyntaxCheck(source)).toHaveLength(source.length);
  });
  it("leaves ordinary floats, attributes and prefixed strings alone", () => {
    const source = 'a = 3.14\nb = x.y.z\nc = 1.5e3\nd = rb"raw"\ne = 10\nf = "v1."\n';
    expect(normalizeForSyntaxCheck(source)).toBe(source);
  });
});
