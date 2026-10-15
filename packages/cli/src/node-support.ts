import product from "../product.json" with { type: "json" };

// Node policy shared by the installed launcher, startup, and doctor. The published range comes
// from `product.json#nodeRange` (the repository's development toolchain pin in the root
// `package.json#engines` is separate). Tested lines: Node 22 LTS from 22.12 and Node 24 LTS.
export const supportedNodeRange = product.nodeRange;
export const minimumNodeVersion = supportedNodeRange.replace(/^>=/, "");
export const testedNodeLines = "Node 22 LTS or Node 24 LTS";

export type NodeSupport = "supported" | "untested" | "unsupported";

function parse(version: string) {
  const [major = 0, minor = 0] = version.replace(/^v/, "").split(".").map(Number);
  return { major, minor };
}

export function nodeSupport(version: string): NodeSupport {
  const { major, minor } = parse(version);
  const minimum = parse(minimumNodeVersion);
  if (major < minimum.major || (major === minimum.major && minor < minimum.minor)) {
    return "unsupported";
  }
  // Odd-numbered (non-LTS) majors and majors newer than the tested lines run, but are untested.
  return major === 22 || major === 24 ? "supported" : "untested";
}
