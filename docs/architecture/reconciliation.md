# Architecture/runtime reconciliation

`@visual-system/reconcile` combines a static repository architecture graph with a normalized execution graph and runtime events. It is deterministic, React-independent, and does not use an LLM.

## Inputs and outputs

```text
ArchitectureGraph + ExecutionGraph + RuntimeEvent[]
                     |
                     v
          ReconciliationResult
            - unified graph
            - reconciled events
            - explainable matches
            - per-component activity
            - unmatched paths/entities
```

The static and runtime graphs are never overwritten. The unified graph is a derived view.

## Matching order

1. exact source path after separator/root normalization;
2. longest workspace/package directory ownership;
3. known integration identity when runtime and static providers/names agree.

A match contains its runtime event/path/entity, architecture entity, match type, confidence, and a human-readable evidence sentence. File events can map to several components. This matters when one Codex file-change operation spans multiple packages.

## Unified graph semantics

Static entities and relationships remain present. Execution entities and edges are added as runtime metadata, and matched events create runtime-observation edges from their observed source (normally Codex) to architecture components. ID collisions are namespaced with `runtime:`.

Terminal, MCP, model, Files, User, and Codex nodes remain valid even when they do not correspond to a repository component. Unknown paths stay in the unmatched list rather than being forced into a false match.

Reconciled events retain the original event ID, category, action, paths, and raw-record association. They add only:

- `architectureEntityIds`, used by replay to illuminate every matched component;
- `architectureMatches`, used by the inspector to explain the match.

Per-component activity records event IDs, unique files, last timestamp, error state, and read/edit/create/delete/other operation counts. This is runtime overlay state and does not modify analyzer confidence or static evidence.

## UI behavior

The **Show execution** toggle selects between the static graph and derived unified graph. In the unified view:

- untouched architecture is muted;
- observed architecture is marked;
- the currently active component receives the strongest existing animation;
- static edges stay thin and subtle;
- runtime edges are brighter/dashed and animate while active;
- the inspector navigates from an event to its component and from a component to its first matching event.

Session changes recompute the overlay. Repository rescan recomputes matching against the new source ownership map.
