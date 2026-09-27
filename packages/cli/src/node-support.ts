// Node policy shared by the installed launcher, startup, and doctor. The supported line is
// Node 24 LTS from 24.19.0 (see `package.json#engines`). Newer majors are allowed but untested.
export const minimumNodeVersion = "24.19.0";
export const supportedNodeRange = ">=24.19.0 <25";

export type NodeSupport = "supported" | "untested-newer" | "unsupported";

export function nodeSupport(version: string): NodeSupport {
  const [major = 0, minor = 0] = version.replace(/^v/, "").split(".").map(Number);
  if (major > 24) return "untested-newer";
  if (major === 24 && minor >= 19) return "supported";
  return "unsupported";
}
