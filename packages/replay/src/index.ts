import type { RuntimeEvent } from "@visual-system/schema";

export const replaySpeeds = [0.5, 1, 2, 4] as const;
export type ReplaySpeed = (typeof replaySpeeds)[number];

export interface ReplaySnapshot {
  currentTimestamp: number;
  durationMs: number;
  progress: number;
  isPlaying: boolean;
  speed: ReplaySpeed;
  currentEvent: RuntimeEvent | undefined;
  activeEvents: readonly RuntimeEvent[];
  completedEvents: readonly RuntimeEvent[];
  activeEntityIds: readonly string[];
  activeConnections: ReadonlyArray<{ source: string; target: string }>;
}

export interface ReplayEngineOptions {
  durationMs?: number;
  minimumActiveMs?: number;
}

export class ReplayEngine {
  private readonly events: RuntimeEvent[];
  private readonly durationMs: number;
  private readonly minimumActiveMs: number;
  private currentTimestamp = 0;
  private isPlaying = false;
  private speed: ReplaySpeed = 1;

  constructor(events: readonly RuntimeEvent[], options: ReplayEngineOptions = {}) {
    this.events = events
      .map((event, inputIndex) => ({ event, inputIndex }))
      .sort((a, b) => a.event.timestamp - b.event.timestamp || a.inputIndex - b.inputIndex)
      .map(({ event }) => event);
    const finalEventEnd = this.events.reduce(
      (maximum, event) => Math.max(maximum, event.timestamp + (event.durationMs ?? 0)),
      0,
    );
    this.durationMs = Math.max(options.durationMs ?? finalEventEnd, finalEventEnd);
    this.minimumActiveMs = options.minimumActiveMs ?? 220;
  }

  play(): ReplaySnapshot {
    if (this.currentTimestamp >= this.durationMs) this.currentTimestamp = 0;
    this.isPlaying = true;
    return this.snapshot();
  }

  pause(): ReplaySnapshot {
    this.isPlaying = false;
    return this.snapshot();
  }

  reset(): ReplaySnapshot {
    this.currentTimestamp = 0;
    this.isPlaying = false;
    return this.snapshot();
  }

  seek(timestamp: number): ReplaySnapshot {
    this.currentTimestamp = Math.min(this.durationMs, Math.max(0, timestamp));
    if (this.currentTimestamp >= this.durationMs) this.isPlaying = false;
    return this.snapshot();
  }

  setSpeed(speed: ReplaySpeed): ReplaySnapshot {
    this.speed = speed;
    return this.snapshot();
  }

  advance(realDeltaMs: number): ReplaySnapshot {
    if (!this.isPlaying || realDeltaMs <= 0) return this.snapshot();
    this.currentTimestamp = Math.min(
      this.durationMs,
      this.currentTimestamp + realDeltaMs * this.speed,
    );
    if (this.currentTimestamp >= this.durationMs) this.isPlaying = false;
    return this.snapshot();
  }

  snapshot(): ReplaySnapshot {
    const activeEvents: RuntimeEvent[] = [];
    const completedEvents: RuntimeEvent[] = [];
    let currentEvent: RuntimeEvent | undefined;

    for (const event of this.events) {
      if (event.timestamp > this.currentTimestamp) break;
      currentEvent = event;
      const effectiveEnd = event.timestamp + Math.max(event.durationMs ?? 0, this.minimumActiveMs);
      if (this.currentTimestamp <= effectiveEnd) activeEvents.push(event);
      else completedEvents.push(event);
    }

    const activeEntityIds = new Set<string>();
    const connectionKeys = new Set<string>();
    const activeConnections: Array<{ source: string; target: string }> = [];

    for (const event of activeEvents) {
      if (event.sourceEntityId) activeEntityIds.add(event.sourceEntityId);
      if (event.targetEntityId) activeEntityIds.add(event.targetEntityId);
      if (event.sourceEntityId && event.targetEntityId) {
        const key = `${event.sourceEntityId}\u0000${event.targetEntityId}`;
        if (!connectionKeys.has(key)) {
          connectionKeys.add(key);
          activeConnections.push({ source: event.sourceEntityId, target: event.targetEntityId });
        }
      }
    }

    return {
      currentTimestamp: this.currentTimestamp,
      durationMs: this.durationMs,
      progress: this.durationMs === 0 ? 0 : this.currentTimestamp / this.durationMs,
      isPlaying: this.isPlaying,
      speed: this.speed,
      currentEvent,
      activeEvents,
      completedEvents,
      activeEntityIds: [...activeEntityIds],
      activeConnections,
    };
  }
}
