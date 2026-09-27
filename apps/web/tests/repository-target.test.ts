import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isSampleRepository,
  sampleRepositories,
  sampleRepositoryPath,
} from "../src/lib/repository-target";

describe("allowlisted sample repositories", () => {
  it("accepts only fixed sample names", () => {
    expect(Object.keys(sampleRepositories).sort()).toEqual(
      ["fastapi", "helm", "infrastructure", "kubernetes", "polyglot", "terraform"].sort(),
    );
    for (const name of ["../etc", "/etc", "polyglot/..", "constructor", "__proto__", ""])
      expect(isSampleRepository(name)).toBe(false);
  });

  it("resolves packaged samples from the install directory, never the source workspace", async () => {
    const samples = join("/opt", "My Tools", "agentmap", "samples");
    expect(await sampleRepositoryPath("infrastructure", { AGENTMAP_SAMPLES_DIR: samples })).toBe(
      join(samples, "infrastructure-ai-platform"),
    );
  });

  it("falls back to workspace fixtures for contributor runs", async () => {
    const path = await sampleRepositoryPath("polyglot", {});
    expect(path.endsWith(join("examples", "polyglot-ai-platform"))).toBe(true);
  });
});
