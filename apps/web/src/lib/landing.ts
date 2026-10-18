import type { PublicSessionSummary } from "@/store/visualization-store";

import {
  pickSessionForRepository,
  sessionBelongsToRepository,
  sessionRelationToRepository,
  sortSessionsNewestFirst,
} from "@visual-system/export";

export { sessionBelongsToRepository, sessionRelationToRepository, sortSessionsNewestFirst };

/** A session changed in the last two minutes counts as running now. */
export function isLiveSession(session: { modifiedAt: string; status?: string }, now = Date.now()) {
  const time = Date.parse(session.modifiedAt);
  return !Number.isNaN(time) && now - time < 120_000;
}

/**
 * Landing rule: open the most recent session that ran inside the current repository.
 * Sessions from other folders are never opened automatically; the user picks those.
 */
export function pickLandingSession(
  repositoryRoot: string | undefined,
  sessions: readonly PublicSessionSummary[],
  now = Date.now(),
) {
  const inside = pickSessionForRepository(repositoryRoot, sessions);
  if (inside) return inside;
  // An agent running right now in a folder that contains the repository (a workspace folder, say)
  // is almost certainly the one the user wants to watch. Older ones stay in the picker.
  return sortSessionsNewestFirst(sessions).find(
    (session) =>
      session.eventCount !== 0 &&
      isLiveSession(session, now) &&
      sessionRelationToRepository(session, repositoryRoot) === "parent",
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
