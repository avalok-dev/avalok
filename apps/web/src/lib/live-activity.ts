import type { Run, RuntimeEvent } from "@visual-system/schema";

export type LiveActivityState = "running" | "thinking" | "waiting" | "idle";

export interface LiveActivity {
  state: LiveActivityState;
  label: string;
  /** Absolute time (ms) the current state began; the strip's timer counts from here. */
  sinceMs: number;
}

/**
 * A pending tool call with no new record for this long may be a permission prompt, or just a slow
 * command: the session files cannot tell them apart, so the label says both.
 */
const approvalHintAfterMs = 30_000;
/**
 * Mid-turn silence this long means the session has probably stopped. Shorter would mislabel real
 * work: local Claude sessions show single model responses of up to ~5 min, and builds run longer.
 */
const stalledAfterMs = 10 * 60_000;

// A Claude session that has started but not been asked anything yet is waiting too.
const turnEnds = new Set(["response.completed", "agent.failed", "agent.aborted", "SessionStart"]);
const isModelOutput = (event: RuntimeEvent) =>
  event.action === "model.response" || event.action === "response.message";

/**
 * Claude events carry absolute times in metadata (absoluteStartMs/absoluteEndMs); Codex events
 * only have `timestamp`, relative to `run.startedAt`.
 */
function startMs(event: RuntimeEvent, runStart: number) {
  const absolute = event.metadata?.absoluteStartMs;
  return typeof absolute === "number" ? absolute : runStart + event.timestamp;
}
function endMs(event: RuntimeEvent, runStart: number) {
  const absolute = event.metadata?.absoluteEndMs;
  return typeof absolute === "number"
    ? absolute
    : startMs(event, runStart) + (event.durationMs ?? 0);
}

/**
 * What the agent is doing right now, from the observed events of a followed session.
 * `modifiedAtMs` is the session file's mtime when the stream opened; the newest event end time
 * takes over once newer records arrive. Returns undefined when there is nothing to show.
 */
export function deriveLiveActivity(
  run: Run,
  modifiedAtMs: number | undefined,
  nowMs: number,
): LiveActivity | undefined {
  const runStart = Date.parse(run.startedAt);
  if (run.events.length === 0 || Number.isNaN(runStart)) return undefined;
  const ordered = [...run.events].sort(
    (left, right) => endMs(left, runStart) - endMs(right, runStart),
  );
  const newestFirst = [...ordered].reverse();
  const latest = newestFirst[0]!;
  // Streamed model output (and Codex's token records) never decides the state on its own: it
  // shares an instant with, or trails, the tool call, turn end or result that does.
  const last = newestFirst.find((event) => !isModelOutput(event)) ?? latest;
  if (last.action === "session.ended") return undefined;
  const lastChanged = Math.max(
    endMs(latest, runStart),
    Number.isFinite(modifiedAtMs) ? modifiedAtMs! : -Infinity,
  );
  const quietMs = nowMs - lastChanged;
  const stalled = { state: "idle", label: "No new activity", sinceMs: lastChanged } as const;

  // Tool calls only count as pending inside the current turn, so a call whose result was never
  // written (an interrupted turn) does not stay "running" forever.
  const boundary = newestFirst.find(
    (event) => event.category === "prompt" || turnEnds.has(event.action),
  );
  const boundaryEnd = boundary ? endMs(boundary, runStart) : -Infinity;
  const pending = ordered.find(
    (event) =>
      startMs(event, runStart) >= boundaryEnd &&
      // Claude: PreToolUse without its PostToolUse yet. Codex (older files): a function call is
      // only written when it starts, so it is pending while nothing has followed it.
      (event.metadata?.phase === "started" ||
        (event === last && event.action === "tool.call" && event.durationMs === undefined)),
  );
  if (pending) {
    if (quietMs >= stalledAfterMs) return stalled;
    const name = pending.metadata?.toolName ?? pending.metadata?.name;
    const running = typeof name === "string" ? `Running ${name}` : "Running a tool";
    return {
      state: "running",
      label: quietMs >= approvalHintAfterMs ? `${running} · may need your approval` : running,
      sinceMs: startMs(pending, runStart),
    };
  }

  const since = endMs(last, runStart);
  // A finished turn waits on the user however long it has been, so it never becomes "stalled".
  if (turnEnds.has(last.action))
    return { state: "waiting", label: "Waiting for you", sinceMs: since };
  if (quietMs >= stalledAfterMs) return stalled;
  // Thinking began at the last prompt or tool result; streamed model output does not reset it.
  return { state: "thinking", label: "Thinking", sinceMs: since };
}

/** 0:07, 12:34, 1:02:03 */
export function formatElapsed(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}
