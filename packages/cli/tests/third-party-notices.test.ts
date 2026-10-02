import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error Plain ESM build script without type declarations.
import { collectPackages, mergePackages, renderNotices } from "../scripts/third-party-notices.mjs";

async function pkg(root: string, path: string, manifest: object, files: Record<string, string>) {
  const directory = join(root, "node_modules", ...path.split("/"));
  await mkdir(join(directory, "lib"), { recursive: true });
  await writeFile(join(directory, "package.json"), JSON.stringify(manifest));
  for (const [name, text] of Object.entries(files)) await writeFile(join(directory, name), text);
  await writeFile(join(directory, "lib", "index.js"), "export {};\n");
  return join(directory, "lib", "index.js");
}

describe("third-party notices", () => {
  it("attributes shipped files to packages, reproduces license texts, and flags copyleft", async () => {
    const root = await mkdtemp(join(tmpdir(), "avalok-notices-"));
    const mit = await pkg(
      root,
      "left-pad",
      { name: "left-pad", version: "1.3.0", license: "MIT", repository: "stevemao/left-pad" },
      { LICENSE: "MIT License\nCopyright (c) Example" },
    );
    const epl = await pkg(
      root,
      "elkjs",
      {
        name: "elkjs",
        version: "0.10.2",
        license: "EPL-2.0",
        repository: { url: "git+https://github.com/kieler/elkjs.git" },
      },
      { "LICENSE.md": "Eclipse Public License - v 2.0" },
    );
    await pkg(
      root,
      "next",
      { name: "next", version: "15.5.26", license: "MIT" },
      { "license.md": "MIT" },
    );
    const vendored = await pkg(
      root,
      "next/dist/compiled/react",
      { name: "react-builtin" },
      { LICENSE: "MIT License (React)" },
    );
    const noText = await pkg(root, "tiny", { name: "tiny", version: "1.0.0", license: "ISC" }, {});
    const workspace = join(root, "packages", "graph", "src", "index.ts");

    const packages = new Map();
    mergePackages(packages, collectPackages([mit, epl, workspace]), "cli");
    mergePackages(packages, collectPackages([mit, vendored, noText]), "dashboard");
    const { text, missingText, count } = renderNotices(packages, {
      product: { displayName: "Avalok" },
      runtimeDependencies: [{ name: "typescript", version: "5.9.3", license: "Apache-2.0" }],
    });

    expect(count).toBe(4);
    expect(text).toContain(
      "| left-pad | 1.3.0 | MIT | cli, dashboard | https://github.com/stevemao/left-pad |",
    );
    expect(text).toContain(
      "| react-builtin | vendored in next@15.5.26 | see license text | dashboard |",
    );
    expect(text).toContain("- elkjs 0.10.2: EPL-2.0. Source: https://github.com/kieler/elkjs");
    expect(text).toContain("Eclipse Public License - v 2.0");
    expect(text).toContain("MIT License\nCopyright (c) Example");
    expect(text).toContain("- typescript 5.9.3 (Apache-2.0)");
    expect(text).not.toContain("graph");
    expect(text).not.toContain(root);
    expect(missingText.map((entry: { name: string }) => entry.name)).toEqual(["tiny"]);
  });
});
