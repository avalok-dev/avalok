# Third-party notices

The published package contains Avalok's own code (Apache-2.0) plus third-party code compiled into `lib/cli.mjs` and the dashboard's JavaScript. `THIRD_PARTY_NOTICES.md` at the package root lists every such component with its license text. It is generated on every `pnpm dist:build` and therefore on every `pnpm release:build`.

## How it is generated

1. **CLI bundle.** esbuild's metafile lists every input file bundled into `lib/cli.mjs`.
2. **Dashboard.** During the packaging build, `apps/web/next.config.ts` registers a small webpack plugin (enabled only when `AVALOK_MODULE_MANIFEST` is set). It records every module bundled by the `server`, `client`, and `edge-server` compilers.
3. `packages/cli/scripts/third-party-notices.mjs` maps each file to its nearest named `package.json` inside `node_modules`, skipping Avalok's workspace source. Packages that Next.js vendors under `next/dist/compiled` are attributed as "vendored in next@<version>".
4. License identifiers come from each package's `package.json`; license texts are the package's own `LICENSE*`, `LICENCE*`, `COPYING*`, and `NOTICE*` files, reproduced verbatim. Nothing is written by hand.
5. Components with copyleft licenses (EPL, MPL, LGPL, GPL, CDDL, EUPL) get an explicit source-availability statement.
6. The build **fails** if any bundled package has neither a license identifier nor a license file. Packages that publish an identifier but no license file are listed in the build output and in the notices.
7. Runtime dependencies that npm installs separately (`typescript`, `@cdktf/hcl2json`) are listed with their licenses; their packages carry their own license files. The pruned modules shipped inside `dashboard/node_modules` (`next`, `react`, `react-dom`, and the rest of Next's traced runtime) are listed in the table as `dashboard-runtime`, with their license texts reproduced from the shipped files.

The installed-product smoke test reads `THIRD_PARTY_NOTICES.md` **from the installed tarball** and fails if it is missing or lacks the elkjs entry, its EPL-2.0 text, or its source link.

To regenerate, run `pnpm dist:build` (or `pnpm release:build` for a release). Dependency changes are picked up automatically; review the component count and the "publish no license file" line in the build output when dependencies change.

## Result for 0.1.0-alpha.1

49 components: MIT, ISC, Apache-2.0, BSD-3-Clause, CC0-1.0, and one EPL-2.0 component. Four packages vendored in Next.js (`@edge-runtime/cookies`, `server-only`, `string-hash`, `ua-parser-js`) publish a license identifier but no separate license file; their identifiers are recorded and they are covered by the Next.js package they ship in.

## elkjs and the Eclipse Public License 2.0

**Facts**

- Package: `elkjs` 0.10.2 (`EPL-2.0`, source: https://github.com/kieler/elkjs). It is a JavaScript build of the Eclipse Layout Kernel.
- Use: `packages/graph` loads `elkjs/lib/elk.bundled.js` with a dynamic import to lay out the canvas. Avalok calls its public API and does not modify any elkjs file (no patches exist in this repository).
- Distribution: webpack compiles the unmodified file into a dashboard JavaScript chunk inside the npm package, i.e. object-code form alongside Apache-2.0 code.

**Obligations this creates (summary, not legal advice)**

EPL-2.0 is a weak, file-level copyleft. Its obligations apply to the EPL-licensed program and modifications of it, not to separate works that only use it. The EPL's definition of "Modified Works" excludes works that merely link to or bind by name to the program. For distributing elkjs unmodified in object-code form alongside Avalok, the EPL requires:

1. The EPL-licensed component remains under the EPL. Avalok does not relicense it.
2. Recipients are informed that the component's source code is available and how to obtain it (§3.2(a)).
3. Copyright and license notices are not removed; a copy of the EPL-2.0 text accompanies the distribution (§3.2, §3.3).

`THIRD_PARTY_NOTICES.md` satisfies 1–3: it names elkjs, its version, and its license; states that it is distributed unmodified; links its source repository and npm version; and reproduces the full EPL-2.0 text from the package.

**Conclusion**

Keeping elkjs is compatible with distributing Avalok under Apache-2.0, provided the notices ship with every package, which the build and smoke test enforce. No change to Avalok's own license is needed, and elkjs was not removed or replaced. If Avalok ever **modifies** elkjs source, the modified files must be made available under the EPL. This is an engineering summary; obtain legal advice if you need a formal opinion.
