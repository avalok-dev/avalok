import type { RuntimeEvent } from "@visual-system/schema";

/** A step this long or longer is "slow"; matches the local run findings threshold (10 s). */
export const slowStepMs = 10_000;

export interface DwellOptions {
  /** How long an event with no recorded duration is shown as a brief pulse. */
  pulseMs?: number;
  /** Fade-out after a pulse (events with no duration, or shorter than the pulse). */
  pulseFadeMs?: number;
  /** Fade-out after an event that has a real duration. */
  fadeMs?: number;
  slowMs?: number;
  /** Overrides the slow check (for example when durations were remapped for playback). */
  isSlow?: (event: RuntimeEvent) => boolean;
}

export interface DwellGlow {
  /** 0 to 1. Full strength while the step is in flight, fading to 0 after it ends. */
  intensity: number;
  /** `dwell` is where the step's time is spent; `caller` is the entity that started it. */
  role: "dwell" | "caller";
  /** The step that is (or just was) running here is slow (>= slowMs). */
  slow: boolean;
  /** The step is still in flight at this timestamp (false while fading out). */
  inFlight: boolean;
}

const callerWeight = 0.45;

/**
 * Where is time being spent right now? A pure function of the events and the timestamp, so
 * seeking, replay and live tailing all agree.
 *
 * - An event with a real duration is in flight from its start to its end. The entity it works
 *   on (its target, or its only entity) glows at full strength for the whole span; the caller
 *   (its source) glows more lightly. After the end the glow fades out.
 * - An event with no recorded duration is only a brief pulse. No dwell time is invented.
 * - Architecture entities that reconciliation attached to an event (metadata
 *   `architectureEntityIds`) are where the work happened, so they glow as dwell entities.
 * - When several events touch an entity, the strongest one wins; dwell beats caller.
 */
export function deriveDwellState(
  events: readonly RuntimeEvent[],
  timestamp: number,
  options: DwellOptions = {},
): ReadonlyMap<string, DwellGlow> {
  const pulseMs = options.pulseMs ?? 220;
  const pulseFadeMs = options.pulseFadeMs ?? 250;
  const fadeMs = options.fadeMs ?? 700;
  const slowMs = options.slowMs ?? slowStepMs;
  const result = new Map<string, DwellGlow>();

  const consider = (
    entityId: string,
    role: DwellGlow["role"],
    strength: number,
    glow: Omit<DwellGlow, "intensity" | "role">,
  ) => {
    const intensity = strength * (role === "caller" ? callerWeight : 1);
    if (intensity <= 0.01) return;
    const existing = result.get(entityId);
    const better =
      !existing ||
      (role === "dwell" && existing.role === "caller") ||
      (role === existing.role && intensity > existing.intensity);
    if (better) result.set(entityId, { intensity, role, ...glow });
  };

  for (const event of events) {
    if (event.timestamp > timestamp) continue;
    const duration = event.durationMs ?? 0;
    const hasDuration = duration > pulseMs;
    const end = event.timestamp + (hasDuration ? duration : pulseMs);
    const fade = hasDuration ? fadeMs : pulseFadeMs;
    let strength: number;
    let inFlight: boolean;
    if (timestamp <= end) {
      strength = hasDuration ? 1 : 0.7;
      inFlight = true;
    } else if (timestamp <= end + fade) {
      strength = (hasDuration ? 1 : 0.7) * (1 - (timestamp - end) / fade);
      inFlight = false;
    } else continue;

    const glow = { slow: options.isSlow ? options.isSlow(event) : duration >= slowMs, inFlight };
    const dwellId = event.targetEntityId ?? event.sourceEntityId;
    if (dwellId) consider(dwellId, "dwell", strength, glow);
    if (event.targetEntityId && event.sourceEntityId)
      consider(event.sourceEntityId, "caller", strength, glow);
    const reconciled = event.metadata?.architectureEntityIds;
    if (Array.isArray(reconciled))
      for (const entityId of reconciled)
        if (typeof entityId === "string") consider(entityId, "dwell", strength, glow);
  }
  return result;
}
