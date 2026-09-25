# Reconciliation instructions

- Reconciliation is deterministic, React-independent, and non-LLM.
- Keep static Architecture Graph, runtime Execution Graph, and derived Unified Graph separate. Never persist overlay state into analyzer output.
- Prefer explainable matching in this order: exact source path, normalized repository path, longest workspace ownership, known route/integration identity.
- Every match needs type, confidence, and evidence. Unknown paths remain unknown; Terminal, model, MCP, and other useful external runtime entities remain visible.
- Preserve original runtime events and attach architecture IDs as derived metadata.
- Test exact/workspace matches, multiple-file events, unknown paths, and unmatched external entities. Focused command: `pnpm --filter @visual-system/reconcile test`.
