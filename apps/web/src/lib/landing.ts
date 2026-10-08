import type { PublicSessionSummary } from "@/store/visualization-store";

function normalizePath(path: string) {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** True when the session ran inside the repository (same folder or a subfolder). */
export function sessionBelongsToRepository(
  session: Pick<PublicSessionSummary, "cwd">,
  repositoryRoot: string | undefined,
) {
  if (!session.cwd || !repositoryRoot) return false;
  const cwd = normalizePath(session.cwd);
  const root = normalizePath(repositoryRoot);
  return cwd === root || cwd.startsWith(`${root}/`);
}

function modifiedTime(session: PublicSessionSummary) {
  const time = Date.parse(session.modifiedAt);
  return Number.isNaN(time) ? 0 : time;
}

/** Newest sessions first. Does not mutate the input. */
export function sortSessionsNewestFirst(sessions: readonly PublicSessionSummary[]) {
  return [...sessions].sort((a, b) => modifiedTime(b) - modifiedTime(a));
}

/**
 * Landing rule: open the most recent session that ran inside the current repository.
 * Sessions from other folders are never opened automatically; the user picks those.
 */
export function pickLandingSession(
  repositoryRoot: string | undefined,
  sessions: readonly PublicSessionSummary[],
) {
  return sortSessionsNewestFirst(sessions).find(
    (session) => session.eventCount !== 0 && sessionBelongsToRepository(session, repositoryRoot),
  );
}

export function relativeTime(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return "unknown time";
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "unknown time";
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(time).toLocaleDateString();
}
