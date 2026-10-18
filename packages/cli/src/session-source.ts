import { avalokDataPaths } from "@visual-system/capabilities";
import {
  defaultClaudeProjectsDirectory,
  discoverClaudeTranscripts,
  loadClaudeTranscript,
  resolveClaudeTranscript,
} from "@visual-system/claude-adapter/transcript";
import {
  discoverCodexSessions,
  loadCodexSession,
  resolveSessionById,
} from "@visual-system/codex-adapter";
import type { ArchitectureGraph, Run } from "@visual-system/schema";
import { LocalRuntimeStore } from "@visual-system/telemetry-adapter";
import { sortSessionsNewestFirst } from "@visual-system/export";

// Where `avalok recap` and `avalok wrapped` get sessions from. Every source the dashboard can show
// has one implementation here, so the commands do not care whether a session came from a Codex
// file, a Claude Code hook, or an OpenTelemetry trace. Adding Kiro or Cursor later means adding a
// source, not touching the commands.
//
// Read-only: nothing in this file writes to Codex's directory or to Avalok's run store.

/** `codex`, `claude` or `telemetry`; taken from the run store's own type. */
export type SessionSourceKind = Awaited<ReturnType<LocalRuntimeStore["list"]>>[number]["source"];

/** What the commands need to know about a session before loading it. */
export interface AgentSession {
  source: SessionSourceKind;
  id: string;
  /** The folder the agent ran in. Runs without one (most OpenTelemetry traces) are never chosen automatically. */
  cwd: string | null;
  modifiedAt: string;
  /** `null` when counting would mean reading the whole file. */
  eventCount: number | null;
}

/** A session's steps and the execution graph they ran through. */
export interface LoadedSession {
  run: Run;
  architecture: ArchitectureGraph;
}

export interface SessionSource {
  /** The kinds of session this source lists and can load. */
  handles: readonly SessionSourceKind[];
  list(): Promise<AgentSession[]>;
  find(id: string): Promise<AgentSession | undefined>;
  load(session: AgentSession): Promise<LoadedSession>;
}

export function codexSessionSource(): SessionSource {
  return {
    handles: ["codex"],
    async list() {
      const sessions = await discoverCodexSessions();
      return sessions.map((session) => ({
        source: "codex" as const,
        id: session.id,
        cwd: session.cwd,
        modifiedAt: session.modifiedAt,
        eventCount: session.eventCount,
      }));
    },
    async find(id) {
      const session = await resolveSessionById(id);
      return session
        ? {
            source: "codex",
            id: session.id,
            cwd: session.cwd,
            modifiedAt: session.modifiedAt,
            eventCount: session.eventCount,
          }
        : undefined;
    },
    async load(session) {
      const found = await resolveSessionById(session.id);
      if (!found) throw new Error("The Codex session file is no longer available.");
      return loadCodexSession(found);
    },
  };
}

/**
 * Runs Avalok stored itself: Claude Code hooks and OpenTelemetry traces (and, later, other
 * hook-based agents). Takes the store directly so tests use a temporary directory.
 *
 * `transcriptsDirectory` also lists Claude Code's own session files, read-only, so Claude Code
 * needs no hooks. Off by default so tests never read the real `~/.claude`.
 */
export function storedRunSessionSource(
  store: Pick<LocalRuntimeStore, "list" | "load"> = new LocalRuntimeStore(
    avalokDataPaths().runtime,
  ),
  transcriptsDirectory?: string,
): SessionSource {
  const list = async () => {
    const stored = (await store.list()).map((session): AgentSession => ({
      source: session.source,
      id: session.id,
      cwd: session.cwd ?? null,
      modifiedAt: session.modifiedAt,
      eventCount: session.eventCount,
    }));
    if (!transcriptsDirectory) return stored;
    const known = new Set(stored.map((session) => `${session.source}:${session.id}`));
    const transcripts = await discoverClaudeTranscripts(transcriptsDirectory).catch(() => []);
    return [
      ...stored,
      ...transcripts
        .filter((session) => !known.has(`claude:${session.id}`))
        .map(
          (session): AgentSession => ({
            source: "claude",
            id: session.id,
            cwd: session.cwd ?? null,
            modifiedAt: session.modifiedAt,
            eventCount: null,
          }),
        ),
    ];
  };
  return {
    handles: ["claude", "telemetry"],
    list,
    async find(id) {
      return (await list()).find((session) => session.id === id);
    },
    async load(session) {
      // The transcript is the complete record; hooks may have started midway through.
      const transcript =
        transcriptsDirectory && session.source === "claude"
          ? await resolveClaudeTranscript(session.id, transcriptsDirectory)
          : undefined;
      const snapshot = transcript
        ? await loadClaudeTranscript(transcript)
        : await store.load(session.source, session.id);
      if (!snapshot) throw new Error("The stored run is no longer available.");
      return { run: snapshot.run, architecture: snapshot.architecture };
    },
  };
}

export function defaultSessionSources(): SessionSource[] {
  return [
    codexSessionSource(),
    storedRunSessionSource(undefined, defaultClaudeProjectsDirectory()),
  ];
}

const sessionKey = (session: Pick<AgentSession, "source" | "id">) =>
  `${session.source}:${session.id}`;

/**
 * Every session from every source, newest first, one entry per source and id. A source that
 * cannot be read is skipped, never fatal.
 */
export async function listAllSessions(sources: readonly SessionSource[]) {
  const lists = await Promise.all(sources.map((source) => source.list().catch(() => [])));
  const unique = new Map<string, AgentSession>();
  for (const session of lists.flat()) unique.set(sessionKey(session), session);
  return sortSessionsNewestFirst([...unique.values()]);
}

/**
 * A session by id. `claude:<id>`, `codex:<id>` or `telemetry:<id>` names the source when two
 * sources happen to use the same id; a bare id takes the newest match.
 */
export async function findSessionById(sources: readonly SessionSource[], reference: string) {
  const prefixed = /^(codex|claude|telemetry):(.+)$/.exec(reference);
  const source = prefixed?.[1] as SessionSourceKind | undefined;
  const id = prefixed?.[2] ?? reference;
  const found = await Promise.all(
    sources.map((candidate) => candidate.find(id).catch(() => undefined)),
  );
  const matches = found.filter(
    (session): session is AgentSession => !!session && (!source || session.source === source),
  );
  return sortSessionsNewestFirst(matches)[0];
}

/** Loads a session through the source that handles its kind. */
export async function loadAnySession(
  sources: readonly SessionSource[],
  session: AgentSession,
): Promise<LoadedSession> {
  const holder = sources.find((candidate) => candidate.handles.includes(session.source));
  if (!holder) throw new Error(`No source can load ${sourceLabel(session.source)} sessions.`);
  return holder.load(session);
}

export function sourceLabel(kind: SessionSourceKind) {
  return kind === "codex" ? "Codex" : kind === "claude" ? "Claude Code" : "OpenTelemetry";
}
