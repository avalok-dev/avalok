# Node and pnpm toolchain

The repository source of truth is:

- `.node-version`: Node `24.19.0`;
- `package.json#engines.node`: Node 24.19 or newer within the Node 24 LTS line;
- `package.json#packageManager`: pnpm `11.19.0`;
- GitHub Actions: the same Node and pnpm versions.

The published `avalok` package supports Node 22.12+ (`packages/cli/product.json#nodeRange`); the settings below are the _development_ toolchain for building this repository. Node 24 is the LTS line selected for modern Next.js, React, TypeScript, and Node services. Node 20 is end-of-life and is not supported by pnpm 11.

With nvm:

```bash
nvm install 24.19.0
nvm use 24.19.0
nvm alias default 24.19.0
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
```

Open a new terminal and verify:

```bash
node --version
pnpm --version
which node
which pnpm
```

Expected versions are `v24.19.0` and `11.19.0`. With nvm and Corepack, paths should resolve beneath `~/.nvm/versions/node/v24.19.0/bin/`; Codex may instead use its bundled Node 24 runtime documented in `AGENTS.md`.

No Node version is removed, and no Xcode/iOS tooling is changed.
