# Event model

Runtime events are ordered observable actions. Each event may identify a source entity, a target entity, a duration, span relationships, and structured metadata.

Events are vendor-neutral and represent activity such as an HTTP request, retrieval, model call, tool call, database query, or response. They do not contain private model chain-of-thought.

The replay engine treats `timestamp` as milliseconds from the start of a run. Events are sorted by timestamp with input order as a stable tiebreaker. An event is active from its timestamp through `timestamp + durationMs`; zero-duration events receive a short visual activation window in the UI.

Static edges remain the source of truth for architecture. A runtime event can activate an existing edge when its source and target match. Future adapters may emit runtime-only connections, which a reconciliation layer can preserve without mutating scanned architecture data.
