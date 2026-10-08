import type { PublicSessionSummary } from "@/store/visualization-store";

/** Browser-side discovery of local Codex sessions and observed runtime runs (no paths are exposed). */
export async function fetchLocalSessions(): Promise<PublicSessionSummary[]> {
  const [codexResponse, runtimeResponse] = await Promise.all([
    fetch("/api/codex/sessions", { cache: "no-store" }),
    fetch("/api/runtime/runs", { cache: "no-store" }),
  ]);
  const codex = (await codexResponse.json()) as { sessions?: PublicSessionSummary[] };
  const runtime = (await runtimeResponse.json()) as { runs?: PublicSessionSummary[] };
  return [
    ...(runtimeResponse.ok ? (runtime.runs ?? []) : []),
    ...(codexResponse.ok ? (codex.sessions ?? []) : []).map((session) => ({
      ...session,
      source: "codex" as const,
    })),
  ];
}
