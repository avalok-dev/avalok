import type { PublicSessionSummary } from "@/store/visualization-store";

export interface LocalSessions {
  sessions: PublicSessionSummary[];
  /** Which lists could not be read. The other list is still returned. */
  failed: ("codex" | "runtime")[];
}

async function readList<T>(fetcher: typeof fetch, url: string, key: string): Promise<T[]> {
  const response = await fetcher(url, { cache: "no-store" });
  const payload = (await response.json()) as Record<string, unknown>;
  const list = payload[key];
  if (!response.ok || !Array.isArray(list)) throw new Error(`${url} failed`);
  return list as T[];
}

/**
 * Browser-side discovery of every local session: Codex files and the runs Avalok stored from
 * Claude Code hooks and OpenTelemetry (no paths are exposed). One list failing never hides the
 * other, so a broken run store cannot stop the landing from opening your newest Codex session.
 * Entries are unique per source and id.
 */
export async function discoverLocalSessions(fetcher: typeof fetch = fetch): Promise<LocalSessions> {
  const [codex, runtime] = await Promise.allSettled([
    readList<PublicSessionSummary>(fetcher, "/api/codex/sessions", "sessions"),
    readList<PublicSessionSummary>(fetcher, "/api/runtime/runs", "runs"),
  ]);
  const discovered = [
    ...(runtime.status === "fulfilled" ? runtime.value : []),
    ...(codex.status === "fulfilled" ? codex.value : []).map((session) => ({
      ...session,
      source: "codex" as const,
    })),
  ];
  const seen = new Set<string>();
  return {
    sessions: discovered.filter((session) => {
      const key = `${session.source ?? "codex"}:${session.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
    failed: [
      ...(codex.status === "rejected" ? (["codex"] as const) : []),
      ...(runtime.status === "rejected" ? (["runtime"] as const) : []),
    ],
  };
}

export async function fetchLocalSessions(): Promise<PublicSessionSummary[]> {
  return (await discoverLocalSessions()).sessions;
}
