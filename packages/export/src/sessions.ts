// Which local agent session should be recapped or opened? Pure helpers shared by the dashboard
// landing and the `avalok recap` command. A session belongs to a repository when it ran inside it;
// sessions from other folders are never chosen automatically.

export interface SessionLike {
  cwd?: string | null;
  modifiedAt: string;
  eventCount?: number | null;
}

function normalizePath(path: string) {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** True when the session ran inside the repository (same folder or a subfolder). */
export function sessionBelongsToRepository(
  session: Pick<SessionLike, "cwd">,
  repositoryRoot: string | undefined,
) {
  if (!session.cwd || !repositoryRoot) return false;
  const cwd = normalizePath(session.cwd);
  const root = normalizePath(repositoryRoot);
  return cwd === root || cwd.startsWith(`${root}/`);
}

/**
 * How a session's folder relates to the repository: `inside` (same folder or a subfolder),
 * `parent` (the agent was started in a folder that contains the repository, which is common when
 * a repository sits in a workspace folder), or `other`.
 */
export function sessionRelationToRepository(
  session: Pick<SessionLike, "cwd">,
  repositoryRoot: string | undefined,
): "inside" | "parent" | "other" {
  if (!session.cwd || !repositoryRoot) return "other";
  if (sessionBelongsToRepository(session, repositoryRoot)) return "inside";
  const cwd = normalizePath(session.cwd);
  const root = normalizePath(repositoryRoot);
  // A bare "/" normalizes to "", which would match everything.
  return cwd !== "" && root.startsWith(`${cwd}/`) ? "parent" : "other";
}

function modifiedTime(session: SessionLike) {
  const time = Date.parse(session.modifiedAt);
  return Number.isNaN(time) ? 0 : time;
}

/** Newest sessions first. Does not mutate the input. */
export function sortSessionsNewestFirst<T extends SessionLike>(sessions: readonly T[]) {
  return [...sessions].sort((a, b) => modifiedTime(b) - modifiedTime(a));
}

/** The newest session that ran inside the repository and has events (or an unknown count). */
export function pickSessionForRepository<T extends SessionLike>(
  repositoryRoot: string | undefined,
  sessions: readonly T[],
) {
  return sortSessionsNewestFirst(sessions).find(
    (session) => session.eventCount !== 0 && sessionBelongsToRepository(session, repositoryRoot),
  );
}
