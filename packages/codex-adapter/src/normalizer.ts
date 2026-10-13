import { looksLikeTestCommand } from "@visual-system/runtime-adapter";
import {
  ArchitectureGraphSchema,
  RunSchema,
  type ArchitectureGraph,
  type Entity,
  type GraphEdge,
  type Run,
  type RuntimeEvent,
} from "@visual-system/schema";
import type { AdapterDiagnostic, CodexSessionSummary, JsonlRecord } from "./types";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const stringValue = (value: unknown) => (typeof value === "string" ? value : undefined);
const numberValue = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "unknown";

function durationMs(value: unknown) {
  if (typeof value === "number") return Math.max(0, value);
  if (!isObject(value)) return undefined;
  const seconds = numberValue(value.secs) ?? 0;
  const nanos = numberValue(value.nanos) ?? 0;
  return Math.max(0, seconds * 1_000 + nanos / 1_000_000);
}

function timestampMs(record: JsonlRecord) {
  if (typeof record.timestamp !== "string") return undefined;
  const value = Date.parse(record.timestamp);
  return Number.isFinite(value) ? value : undefined;
}

function compactRaw(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[depth limit]";
  if (typeof value === "string") {
    return value.length > 4_000 ? `${value.slice(0, 4_000)}… [truncated]` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => compactRaw(item, depth + 1));
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 80)
      .map(([key, item]) => [key, compactRaw(item, depth + 1)]),
  );
}

function contentText(value: unknown) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return undefined;
  const parts = value.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (isObject(item) && typeof item.text === "string") return [item.text];
    return [];
  });
  return parts.length > 0 ? parts.join("\n") : undefined;
}

function commandText(value: unknown) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return undefined;
  const parts = value.filter((item): item is string => typeof item === "string");
  if (parts.length === 0) return undefined;
  return parts.length >= 3 && ["-lc", "-c"].includes(parts.at(-2) ?? "")
    ? parts.at(-1)
    : parts.join(" ");
}

const looksLikeTest = looksLikeTestCommand;

interface NormalizedOutput {
  events: RuntimeEvent[];
  rawEvents: Record<string, unknown>;
  architecture: ArchitectureGraph;
  run: Run;
  diagnostics: AdapterDiagnostic[];
}

export class CodexNormalizer {
  private readonly entities = new Map<string, Entity>();
  private readonly edges = new Map<string, GraphEdge>();
  private readonly events = new Map<string, RuntimeEvent>();
  private readonly rawEvents = new Map<string, unknown>();
  private readonly diagnostics: AdapterDiagnostic[] = [];
  private readonly seenResponses = new Set<string>();
  private originMs: number | undefined;
  private startedAtMs: number | undefined;
  private endedAtMs: number | undefined;
  private latestTaskStartMs: number | undefined;
  private latestTaskEndMs: number | undefined;
  private prompt = "Codex session";
  private hasPrompt = false;
  private model: string | undefined;
  private inputTokens: number | null = null;
  private outputTokens: number | null = null;
  private toolCallCount = 0;
  private modelCallCount = 0;
  private latestTaskOutcome: "completed" | "aborted" | undefined;
  private observedCompletedItems = false;

  constructor(private readonly session: CodexSessionSummary) {
    this.addEntity({
      id: "user",
      kind: "user",
      name: "User",
      description: "The user interacting with this local Codex session.",
    });
    this.addEntity({
      id: "codex",
      kind: "agent",
      name: "Codex",
      provider: "OpenAI",
      description: "The local coding agent coordinating this session.",
      metadata: { originator: session.originator, cliVersion: session.cliVersion },
    });
    this.addEdge("user", "codex", "prompt");
  }

  addDiagnostics(diagnostics: readonly AdapterDiagnostic[]) {
    this.diagnostics.push(...diagnostics);
  }

  ingest(entries: ReadonlyArray<{ record: JsonlRecord; line: number }>) {
    this.observedCompletedItems ||= entries.some(
      ({ record }) =>
        record.type === "event_msg" &&
        isObject(record.payload) &&
        record.payload.type === "item_completed",
    );
    const emitted: RuntimeEvent[] = [];
    for (const { record, line } of entries) {
      const event = this.normalizeRecord(record, line, this.observedCompletedItems);
      if (event) emitted.push(event);
    }
    return emitted;
  }

  private addEntity(entity: Entity) {
    if (!this.entities.has(entity.id)) this.entities.set(entity.id, entity);
  }

  private addEdge(source: string, target: string, label: string) {
    const id = `edge:${source}:${target}`;
    if (!this.edges.has(id)) this.edges.set(id, { id, source, target, label });
  }

  private ensureTarget(kind: "terminal" | "files" | "tests" | "model" | "web", name?: string) {
    const definitions = {
      terminal: {
        id: "terminal",
        kind: "tool" as const,
        name: "Terminal",
        description: "Commands executed by Codex in the local shell.",
      },
      files: {
        id: "files",
        kind: "storage" as const,
        name: "Files",
        description: "Files changed during this session, grouped to keep large runs readable.",
      },
      tests: {
        id: "tests",
        kind: "tool" as const,
        name: "Tests",
        description: "Test and verification commands observed in the session.",
      },
      model: {
        id: "model",
        kind: "model" as const,
        name: name ?? "Model",
        provider: "OpenAI",
        description: "Model responses recorded by the local Codex session.",
      },
      web: {
        id: "web",
        kind: "web" as const,
        name: "Web",
        description: "Web searches recorded by the local Codex session.",
      },
    };
    const entity = definitions[kind];
    this.addEntity(entity);
    this.addEdge("codex", entity.id, kind === "model" ? "inference" : kind);
    return entity.id;
  }

  private ensureMcp(server: string) {
    const id = `mcp:${slug(server)}`;
    this.addEntity({
      id,
      kind: "mcp_server",
      name: `${server} MCP`,
      provider: "MCP",
      description: `MCP server observed in this Codex session.`,
    });
    this.addEdge("codex", id, "MCP");
    return id;
  }

  private emit(
    record: JsonlRecord,
    id: string,
    category: RuntimeEvent["category"],
    action: string,
    sourceEntityId: string | undefined,
    targetEntityId: string | undefined,
    metadata?: Record<string, unknown>,
    explicitDurationMs?: number,
  ) {
    const absolute = timestampMs(record) ?? this.startedAtMs ?? Date.parse(this.session.modifiedAt);
    this.originMs ??= absolute;
    this.startedAtMs = Math.min(this.startedAtMs ?? absolute, absolute);
    this.endedAtMs = Math.max(this.endedAtMs ?? absolute, absolute);
    const duration = explicitDurationMs;
    const start = Math.max(0, absolute - this.originMs - (duration ?? 0));
    const event: RuntimeEvent = {
      id,
      traceId: this.session.id,
      timestamp: start,
      category,
      action,
      ...(duration === undefined ? {} : { durationMs: duration }),
      ...(sourceEntityId ? { sourceEntityId } : {}),
      ...(targetEntityId ? { targetEntityId } : {}),
      ...(metadata ? { metadata } : {}),
    };
    this.events.set(id, event);
    this.rawEvents.set(id, compactRaw(record));
    return event;
  }

  private normalizeRecord(record: JsonlRecord, line: number, hasCompletedItems: boolean) {
    const payload = isObject(record.payload) ? record.payload : undefined;
    const time = timestampMs(record);
    if (time !== undefined) {
      this.originMs ??= time;
      this.startedAtMs = Math.min(this.startedAtMs ?? time, time);
      this.endedAtMs = Math.max(this.endedAtMs ?? time, time);
    }

    if (record.type === "turn_context" && payload) {
      const model = stringValue(payload.model);
      if (model) {
        this.model = model;
        this.ensureTarget("model", model);
      }
      return undefined;
    }

    if (record.type === "event_msg" && payload?.type === "task_started") {
      this.latestTaskStartMs = time;
      return this.emit(
        record,
        `task:${stringValue(payload.turn_id) ?? String(record.ordinal ?? line)}:start`,
        "agent",
        "agent.start",
        "user",
        "codex",
        { turnId: payload.turn_id },
      );
    }

    if (record.type === "event_msg" && payload?.type === "user_message") {
      const text = stringValue(payload.message);
      if (text && !this.hasPrompt) {
        this.prompt = text.slice(0, 2_000);
        this.hasPrompt = true;
      }
      return this.emit(
        record,
        `message:${String(record.ordinal ?? line)}:user`,
        "prompt",
        "prompt.received",
        "user",
        "codex",
        { preview: text?.slice(0, 240) },
      );
    }

    if (record.type === "event_msg" && payload?.type === "agent_message") {
      const text = stringValue(payload.message);
      return this.emit(
        record,
        `message:${String(record.ordinal ?? line)}:agent`,
        "response",
        "response.message",
        "codex",
        "user",
        { phase: payload.phase, preview: text?.slice(0, 240) },
      );
    }

    if (
      record.type === "event_msg" &&
      (payload?.type === "task_complete" || payload?.type === "turn_aborted")
    ) {
      this.latestTaskEndMs = time;
      this.latestTaskOutcome = payload.type === "turn_aborted" ? "aborted" : "completed";
      return this.emit(
        record,
        `task:${stringValue(payload.turn_id) ?? String(record.ordinal ?? line)}:end`,
        payload.type === "turn_aborted" ? "error" : "response",
        payload.type === "turn_aborted" ? "agent.aborted" : "response.completed",
        "codex",
        "user",
        {
          turnId: payload.turn_id,
          durationMs: payload.duration_ms,
          timeToFirstTokenMs: payload.time_to_first_token_ms,
          ...(payload.type === "turn_aborted" ? { reason: payload.reason } : {}),
        },
        numberValue(payload.duration_ms),
      );
    }

    if (
      record.type === "event_msg" &&
      payload?.type === "item_completed" &&
      isObject(payload.item)
    ) {
      const item = payload.item;
      const type = stringValue(item.type);
      const id = stringValue(item.id) ?? `item:${String(record.ordinal ?? line)}`;
      if (type === "UserMessage") {
        const text = contentText(item.content);
        if (text && !this.hasPrompt) {
          this.prompt = text.slice(0, 2_000);
          this.hasPrompt = true;
        }
        return this.emit(record, id, "prompt", "prompt.received", "user", "codex", {
          preview: text?.slice(0, 240),
        });
      }
      if (type === "AgentMessage") {
        const text = contentText(item.content);
        return this.emit(record, id, "response", "response.message", "codex", "user", {
          phase: item.phase,
          preview: text?.slice(0, 240),
        });
      }
      if (type === "CommandExecution") {
        const command = commandText(item.command) ?? "Command unavailable";
        const isTest = looksLikeTest(command);
        const target = this.ensureTarget(isTest ? "tests" : "terminal");
        const failed = item.status === "failed" || (numberValue(item.exit_code) ?? 0) !== 0;
        this.toolCallCount += 1;
        return this.emit(
          record,
          id,
          failed ? "error" : "tool",
          isTest ? "terminal.test" : "terminal.command",
          "codex",
          target,
          {
            command: command.slice(0, 1_000),
            cwd: item.cwd,
            status: item.status,
            exitCode: item.exit_code,
            outputPreview: stringValue(item.aggregated_output)?.slice(0, 500),
          },
          durationMs(item.duration),
        );
      }
      if (type === "FileChange") {
        const changes = isObject(item.changes) ? item.changes : {};
        const files = Object.keys(changes);
        const fileOperations = Object.entries(changes).map(([path, change]) => {
          const details = isObject(change) ? change : undefined;
          const observed =
            stringValue(details?.kind) ??
            stringValue(details?.type) ??
            stringValue(details?.change_type);
          const normalized = observed?.toLowerCase();
          const operation =
            normalized?.includes("add") || normalized?.includes("create")
              ? "create"
              : normalized?.includes("delete") || normalized?.includes("remove")
                ? "delete"
                : "edit";
          return { path, operation };
        });
        this.toolCallCount += 1;
        return this.emit(
          record,
          id,
          item.status === "failed" ? "error" : "file",
          "files.changed",
          "codex",
          this.ensureTarget("files"),
          {
            status: item.status,
            fileCount: files.length,
            files: files.slice(0, 40),
            fileOperations: fileOperations.slice(0, 40),
          },
        );
      }
      if (type === "McpToolCall") {
        const server = stringValue(item.server) ?? "unknown";
        const tool = stringValue(item.tool) ?? "unknown";
        const failed =
          item.status === "failed" || (isObject(item.result) && item.result.isError === true);
        this.toolCallCount += 1;
        return this.emit(
          record,
          id,
          failed ? "error" : "mcp",
          "mcp.tool_call",
          "codex",
          this.ensureMcp(server),
          { server, tool, status: item.status, arguments: compactRaw(item.arguments, 1) },
          durationMs(item.duration),
        );
      }
      return undefined;
    }

    if (record.type === "token_usage_record" && payload) {
      const usage = isObject(payload.thread_token_usage)
        ? payload.thread_token_usage
        : isObject(payload.usage)
          ? payload.usage
          : undefined;
      if (usage) {
        this.inputTokens = numberValue(usage.input_tokens) ?? this.inputTokens;
        this.outputTokens = numberValue(usage.output_tokens) ?? this.outputTokens;
      }
      const responseId = stringValue(payload.response_id);
      if (!responseId || this.seenResponses.has(responseId)) return undefined;
      this.seenResponses.add(responseId);
      this.modelCallCount += 1;
      return this.emit(
        record,
        `model:${responseId}`,
        "model",
        "model.response",
        "codex",
        this.ensureTarget("model", this.model),
        usage
          ? {
              responseId,
              inputTokens: usage.input_tokens,
              outputTokens: usage.output_tokens,
              cachedInputTokens: usage.cached_input_tokens,
            }
          : { responseId },
      );
    }

    if (record.type === "response_item" && payload?.type === "web_search_call") {
      const action = isObject(payload.action) ? payload.action : undefined;
      this.toolCallCount += 1;
      return this.emit(
        record,
        stringValue(payload.id) ?? `web:${String(record.ordinal ?? line)}`,
        payload.status === "failed" ? "error" : "web",
        "web.search",
        "codex",
        this.ensureTarget("web"),
        {
          status: payload.status,
          query: action?.query,
          queries: action?.queries,
          action: action?.type,
        },
      );
    }

    if (!hasCompletedItems && record.type === "response_item" && payload) {
      const type = stringValue(payload.type);
      if (type === "function_call" || type === "custom_tool_call") {
        const name = stringValue(payload.name) ?? "tool";
        this.toolCallCount += 1;
        return this.emit(
          record,
          stringValue(payload.id) ?? `call:${String(record.ordinal ?? line)}`,
          name.startsWith("mcp__") ? "mcp" : "tool",
          "tool.call",
          "codex",
          name.startsWith("mcp__")
            ? this.ensureMcp(name.split("__")[1] ?? "unknown")
            : this.ensureTarget("terminal"),
          { name, namespace: payload.namespace },
        );
      }
    }

    const known = new Set([
      "session_meta",
      "response_item",
      "event_msg",
      "turn_context",
      "token_usage_record",
      "compacted",
      "world_state",
    ]);
    if (typeof record.type === "string" && !known.has(record.type)) {
      this.diagnostics.push({
        severity: "info",
        code: "record.unsupported",
        message: `Ignored unsupported record type: ${record.type}`,
        line,
      });
    }
    return undefined;
  }

  result(): NormalizedOutput {
    const events = [...this.events.values()].sort(
      (left, right) => left.timestamp - right.timestamp || left.id.localeCompare(right.id),
    );
    const start = this.startedAtMs ?? Date.parse(this.session.modifiedAt);
    const end = this.endedAtMs ?? start;
    const latestEnd = Math.max(
      0,
      ...events.map((event) => event.timestamp + (event.durationMs ?? 0)),
      end - start,
    );
    const running =
      this.latestTaskStartMs !== undefined &&
      (this.latestTaskEndMs === undefined || this.latestTaskStartMs > this.latestTaskEndMs);
    const status = running
      ? "running"
      : this.latestTaskOutcome === "aborted"
        ? "error"
        : "completed";
    const titleBase = this.session.cwd?.split("/").filter(Boolean).at(-1) ?? "Codex session";
    const architecture = ArchitectureGraphSchema.parse({
      id: `codex:${this.session.id}`,
      title: titleBase,
      entities: [...this.entities.values()],
      edges: [...this.edges.values()],
    });
    const run = RunSchema.parse({
      id: this.session.id,
      title: `${titleBase} · Codex session`,
      prompt: this.prompt,
      startedAt: new Date(start).toISOString(),
      ...(running ? {} : { endedAt: new Date(end).toISOString() }),
      totalDurationMs: latestEnd,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      estimatedCostUsd: null,
      toolCallCount: this.toolCallCount,
      modelCallCount: this.modelCallCount,
      status,
      events,
    });
    return {
      events,
      rawEvents: Object.fromEntries(this.rawEvents),
      architecture,
      run,
      diagnostics: [...this.diagnostics],
    };
  }
}
