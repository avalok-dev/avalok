# Repository analyzer instructions

- This package performs bounded static analysis only. Never execute/import target code, spawn commands, install dependencies, evaluate configuration, fetch URLs, read `.env` values, follow symlinks, or write to the target repository.
- Keep stages separated: inventory, manifests, source parsing, import resolution, detectors, inference, evidence/confidence, graph generation.
- Rules must generalize beyond Avalok. Add fixture evidence instead of repository-name/path special cases.
- Return useful partial analysis with diagnostics when limits or malformed files are encountered; do not crash the whole scan.
- Do not promote every dependency into a graph node. Require architecturally meaningful evidence and expose uncertainty.
- Test the current repository, the Next.js fixture, the generic TypeScript fixture, cache/safety, and limit behavior. Focused command: `pnpm --filter @visual-system/analyzer test`.
