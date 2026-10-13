import type { ArchitectureGraph, Run, RuntimeEvent } from "@visual-system/schema";

export type RuntimeSourceKind = "codex" | "claude" | "telemetry";

export interface RuntimeSourceCapabilities {
  historical: boolean;
  live: boolean;
  tokens: boolean;
  cost: boolean;
  files: boolean;
  commands: boolean;
  mcp: boolean;
  models: boolean;
  rawEvents: boolean;
  architectureReconciliation: boolean;
}

export interface RuntimeSourceDescriptor {
  id: RuntimeSourceKind;
  name: string;
  description: string;
  capabilities: RuntimeSourceCapabilities;
}

export interface RuntimeDiagnostic {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  line?: number;
  count?: number;
  timestamp?: string;
}

export interface RuntimeSessionSummary {
  id: string;
  source: RuntimeSourceKind;
  title: string;
  startedAt: string;
  modifiedAt: string;
  status: "active" | "completed" | "error" | "unknown";
  serviceName?: string;
  eventCount: number;
  traceId?: string;
  cwd?: string;
}

export interface RuntimeSnapshot {
  source: RuntimeSourceDescriptor;
  session: RuntimeSessionSummary;
  architecture: ArchitectureGraph;
  run: Run;
  rawEvents: Record<string, unknown>;
  diagnostics: RuntimeDiagnostic[];
}

export interface RuntimeDelta {
  events: RuntimeEvent[];
  rawEvents: Record<string, unknown>;
  architecture: ArchitectureGraph;
  metrics: Pick<
    Run,
    | "inputTokens"
    | "outputTokens"
    | "estimatedCostUsd"
    | "toolCallCount"
    | "modelCallCount"
    | "status"
    | "totalDurationMs"
    | "endedAt"
  >;
  diagnostics: RuntimeDiagnostic[];
}

export interface RuntimeAdapter {
  readonly source: RuntimeSourceDescriptor;
  discover(): Promise<RuntimeSessionSummary[]>;
  load(id: string): Promise<RuntimeSnapshot | undefined>;
}

export const runtimeSources: Record<RuntimeSourceKind, RuntimeSourceDescriptor> = {
  codex: {
    id: "codex",
    name: "Codex",
    description: "Local Codex session history and live JSONL observations.",
    capabilities: {
      historical: true,
      live: true,
      tokens: true,
      cost: false,
      files: true,
      commands: true,
      mcp: true,
      models: true,
      rawEvents: true,
      architectureReconciliation: true,
    },
  },
  claude: {
    id: "claude",
    name: "Claude Code",
    description: "Supported Claude Code lifecycle hooks and OpenTelemetry observations.",
    capabilities: {
      historical: true,
      live: true,
      tokens: true,
      cost: false,
      files: true,
      commands: true,
      mcp: true,
      models: true,
      rawEvents: true,
      architectureReconciliation: true,
    },
  },
  telemetry: {
    id: "telemetry",
    name: "Telemetry",
    description: "Local OTLP/HTTP traces with OpenInference-aware normalization.",
    capabilities: {
      historical: true,
      live: true,
      tokens: true,
      cost: false,
      files: true,
      commands: false,
      mcp: true,
      models: true,
      rawEvents: true,
      architectureReconciliation: true,
    },
  },
};

export interface ValuePolicy {
  maxStringLength: number;
  maxArrayLength: number;
  maxObjectKeys: number;
  maxDepth: number;
}

export const defaultValuePolicy: ValuePolicy = {
  maxStringLength: 4_000,
  maxArrayLength: 50,
  maxObjectKeys: 80,
  maxDepth: 6,
};

export interface SanitizationStats {
  redactedFields: number;
  truncatedFields: number;
}

export interface TruncatedValue {
  value: unknown;
  truncated: true;
  originalSize?: number;
}

const sensitiveKey = (key: string) => {
  const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
  return [
    "authorization",
    "apikey",
    "token",
    "accesstoken",
    "refreshtoken",
    "cookie",
    "setcookie",
    "password",
    "secret",
    "clientsecret",
    "secretkey",
    "secretaccesskey",
    "privatekey",
    "passwd",
    "passphrase",
    "credential",
    "credentials",
    "databaseurl",
    "connectionstring",
  ].some((candidate) => normalized === candidate || normalized.endsWith(candidate));
};

function sanitizeInternal(
  value: unknown,
  stats: SanitizationStats,
  policy: ValuePolicy,
  depth: number,
  key?: string,
): unknown {
  if (key && sensitiveKey(key)) {
    stats.redactedFields += 1;
    return "[REDACTED]";
  }
  if (depth > policy.maxDepth) {
    stats.truncatedFields += 1;
    return {
      value: "[depth limit]",
      truncated: true,
    } satisfies TruncatedValue;
  }
  if (typeof value === "string") {
    if (value.length <= policy.maxStringLength) return value;
    stats.truncatedFields += 1;
    return {
      value: `${value.slice(0, policy.maxStringLength)}…`,
      truncated: true,
      originalSize: value.length,
    } satisfies TruncatedValue;
  }
  if (Array.isArray(value)) {
    const bounded = value
      .slice(0, policy.maxArrayLength)
      .map((item) => sanitizeInternal(item, stats, policy, depth + 1));
    if (value.length <= policy.maxArrayLength) return bounded;
    stats.truncatedFields += 1;
    return {
      value: bounded,
      truncated: true,
      originalSize: value.length,
    } satisfies TruncatedValue;
  }
  if (typeof value !== "object" || value === null) return value;
  const entries = Object.entries(value);
  const bounded = Object.fromEntries(
    entries
      .slice(0, policy.maxObjectKeys)
      .map(([childKey, item]) => [
        childKey,
        sanitizeInternal(item, stats, policy, depth + 1, childKey),
      ]),
  );
  if (entries.length <= policy.maxObjectKeys) return bounded;
  stats.truncatedFields += 1;
  return {
    value: bounded,
    truncated: true,
    originalSize: entries.length,
  } satisfies TruncatedValue;
}

export function sanitizeValue(
  value: unknown,
  policy: ValuePolicy = defaultValuePolicy,
): { value: unknown; stats: SanitizationStats } {
  const stats: SanitizationStats = { redactedFields: 0, truncatedFields: 0 };
  return { value: sanitizeInternal(value, stats, policy, 0), stats };
}

export function boundedText(value: unknown, maximum = defaultValuePolicy.maxStringLength) {
  if (typeof value !== "string") return undefined;
  if (value.length <= maximum) return { value, truncated: false, originalSize: value.length };
  return { value: `${value.slice(0, maximum)}…`, truncated: true, originalSize: value.length };
}

export function deltaBetween(previous: RuntimeSnapshot, current: RuntimeSnapshot): RuntimeDelta {
  const previousEvents = new Map(previous.run.events.map((event) => [event.id, event]));
  const events = current.run.events.filter((event) => {
    const prior = previousEvents.get(event.id);
    return !prior || JSON.stringify(prior) !== JSON.stringify(event);
  });
  const eventIds = new Set(events.map((event) => event.id));
  return {
    events,
    rawEvents: Object.fromEntries(
      Object.entries(current.rawEvents).filter(([eventId]) => eventIds.has(eventId)),
    ),
    architecture: current.architecture,
    metrics: {
      inputTokens: current.run.inputTokens,
      outputTokens: current.run.outputTokens,
      estimatedCostUsd: current.run.estimatedCostUsd,
      toolCallCount: current.run.toolCallCount,
      modelCallCount: current.run.modelCallCount,
      status: current.run.status,
      totalDurationMs: current.run.totalDurationMs,
      endedAt: current.run.endedAt,
    },
    diagnostics: current.diagnostics.slice(previous.diagnostics.length),
  };
}

/** True when a shell command looks like a test run (pnpm/npm/yarn/bun test, vitest, jest, pytest, cargo test, go test). */
export function looksLikeTestCommand(command: string) {
  return /(?:^|[;&|]\s*)(?:pnpm|npm|yarn|bun)(?:\s+run)?\s+test\b|\b(?:vitest|jest|pytest|cargo\s+test|go\s+test)\b/i.test(
    command,
  );
}
