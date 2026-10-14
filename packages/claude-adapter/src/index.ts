import {
  boundedText,
  looksLikeTestCommand,
  runtimeSources,
  sanitizeValue,
  type RuntimeDiagnostic,
  type RuntimeSnapshot,
} from "@visual-system/runtime-adapter";
import {
  ArchitectureGraphSchema,
  RunSchema,
  type Entity,
  type EventCategory,
  type GraphEdge,
} from "@visual-system/schema";

export interface ClaudeHookRecord {
  session_id?: unknown;
  prompt_id?: unknown;
  cwd?: unknown;
  hook_event_name?: unknown;
  tool_name?: unknown;
  tool_input?: unknown;
  tool_response?: unknown;
  tool_use_id?: unknown;
  duration_ms?: unknown;
  prompt?: unknown;
  model?: unknown;
  last_assistant_message?: unknown;
  error?: unknown;
  error_details?: unknown;
  reason?: unknown;
  receivedAt?: unknown;
  [key: string]: unknown;
}

const objectValue = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const stringValue = (value: unknown) => (typeof value === "string" ? value : undefined);
const numberValue = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "unknown";

function toolTarget(toolName: string, input: Record<string, unknown> | undefined) {
  const lower = toolName.toLowerCase();
  if (lower.startsWith("mcp__")) {
    const server = toolName.split("__")[1] ?? "unknown";
    return {
      category: "mcp" as EventCategory,
      action: "mcp.tool_call",
      entity: {
        id: `mcp:${slug(server)}`,
        kind: "mcp_server" as const,
        name: `${server} MCP`,
        provider: "MCP",
      },
    };
  }
  if (["read", "edit", "write", "multiedit", "notebookedit"].includes(lower)) {
    const changed = lower !== "read";
    return {
      category: "file" as EventCategory,
      action: changed ? "files.changed" : "files.read",
      entity: { id: "files", kind: "storage" as const, name: "Files", provider: "Local" },
    };
  }
  if (["bash", "powershell"].includes(lower)) {
    const command = stringValue(input?.command);
    if (command && looksLikeTestCommand(command))
      return {
        category: "tool" as EventCategory,
        action: "terminal.test",
        entity: { id: "tests", kind: "tool" as const, name: "Tests", provider: "Local" },
      };
    return {
      category: "tool" as EventCategory,
      action: "terminal.command",
      entity: { id: "terminal", kind: "tool" as const, name: "Terminal", provider: "Local" },
    };
  }
  if (lower.includes("web") || typeof input?.url === "string") {
    return {
      category: "web" as EventCategory,
      action: "web.activity",
      entity: { id: "web", kind: "web" as const, name: "Internet" },
    };
  }
  return {
    category: "tool" as EventCategory,
    action: "tool.call",
    entity: { id: `tool:${slug(toolName)}`, kind: "tool" as const, name: toolName },
  };
}

function fileMetadata(toolName: string, input: Record<string, unknown> | undefined) {
  const path =
    stringValue(input?.file_path) ?? stringValue(input?.path) ?? stringValue(input?.notebook_path);
  if (!path) return {};
  const lower = toolName.toLowerCase();
  const operation = lower === "read" ? "read" : lower.includes("write") ? "create" : "edit";
  return { file: path, files: [path], fileOperations: [{ path, operation }] };
}

export function normalizeClaudeHook(input: unknown, receivedAt = Date.now()): RuntimeSnapshot {
  const record = objectValue(input) as ClaudeHookRecord | undefined;
  if (!record) throw new Error("Claude hook payload must be a JSON object.");
  const sessionId = stringValue(record.session_id);
  const hookEvent = stringValue(record.hook_event_name);
  if (!sessionId || !hookEvent)
    throw new Error("Claude hook payload is missing session_id or hook_event_name.");
  const observedAt = Date.parse(stringValue(record.receivedAt) ?? "") || receivedAt;
  const cwd = stringValue(record.cwd);
  const titleBase = cwd?.split(/[\\/]/).filter(Boolean).at(-1) ?? "Claude Code";
  const entities = new Map<string, Entity>([
    ["user", { id: "user", kind: "user", name: "User" }],
    ["claude", { id: "claude", kind: "agent", name: "Claude Code", provider: "Anthropic" }],
  ]);
  const edges = new Map<string, GraphEdge>([
    [
      "edge:user:claude",
      { id: "edge:user:claude", source: "user", target: "claude", label: "prompt" },
    ],
  ]);
  let id = `claude:${sessionId}:${hookEvent}:${observedAt}`;
  let category: EventCategory = "agent";
  let action = hookEvent;
  let sourceEntityId = "user";
  let targetEntityId = "claude";
  let status: "running" | "completed" | "error" = "running";
  let prompt = "Claude Code session";
  const durationMs = numberValue(record.duration_ms);
  let metadata: Record<string, unknown> = { hookEvent, absoluteStartMs: observedAt };

  if (hookEvent === "UserPromptSubmit") {
    id = `claude:${sessionId}:prompt:${stringValue(record.prompt_id) ?? observedAt}`;
    category = "prompt";
    action = "prompt.received";
    const bounded = boundedText(record.prompt, 2_000);
    prompt = bounded?.value ?? prompt;
    metadata = {
      ...metadata,
      promptPreview: boundedText(record.prompt, 240)?.value,
      promptTruncated: bounded?.truncated,
    };
  } else if (["PreToolUse", "PostToolUse", "PostToolUseFailure"].includes(hookEvent)) {
    const toolName = stringValue(record.tool_name) ?? "Unknown tool";
    const toolInput = objectValue(record.tool_input);
    const target = toolTarget(toolName, toolInput);
    entities.set(target.entity.id, target.entity);
    edges.set(`edge:claude:${target.entity.id}`, {
      id: `edge:claude:${target.entity.id}`,
      source: "claude",
      target: target.entity.id,
      label: target.category,
    });
    id = `claude:${sessionId}:tool:${stringValue(record.tool_use_id) ?? observedAt}`;
    category = hookEvent === "PostToolUseFailure" ? "error" : target.category;
    action =
      hookEvent === "PostToolUseFailure"
        ? `${target.action}.error`
        : hookEvent === "PreToolUse"
          ? `${target.action}.started`
          : target.action;
    sourceEntityId = "claude";
    targetEntityId = target.entity.id;
    status = hookEvent === "PostToolUseFailure" ? "error" : "running";
    const command = stringValue(toolInput?.command);
    metadata = {
      ...metadata,
      toolName,
      toolUseId: record.tool_use_id,
      phase:
        hookEvent === "PreToolUse"
          ? "started"
          : hookEvent === "PostToolUse"
            ? "completed"
            : "error",
      ...(command ? { command: boundedText(command, 1_000)?.value } : {}),
      ...fileMetadata(toolName, toolInput),
      ...(hookEvent === "PostToolUseFailure"
        ? { error: record.error, errorDetails: record.error_details }
        : {}),
    };
  } else if (hookEvent === "Stop") {
    id = `claude:${sessionId}:stop:${stringValue(record.prompt_id) ?? observedAt}`;
    category = "response";
    action = "response.completed";
    sourceEntityId = "claude";
    targetEntityId = "user";
    status = "completed";
    metadata = {
      ...metadata,
      responsePreview: boundedText(record.last_assistant_message, 240)?.value,
    };
  } else if (hookEvent === "StopFailure") {
    category = "error";
    action = "agent.failed";
    sourceEntityId = "claude";
    targetEntityId = "user";
    status = "error";
    metadata = { ...metadata, error: record.error, errorDetails: record.error_details };
  } else if (hookEvent === "SessionEnd") {
    category = "response";
    action = "session.ended";
    sourceEntityId = "claude";
    targetEntityId = "user";
    status = "completed";
    metadata = { ...metadata, reason: record.reason };
  } else if (hookEvent !== "SessionStart") {
    metadata = { ...metadata, unsupported: true };
  }

  if (durationMs !== undefined) metadata.absoluteStartMs = observedAt - durationMs;
  metadata.absoluteEndMs = observedAt;
  const sanitized = sanitizeValue(record);
  const sanitizedMetadata = sanitizeValue(metadata);
  const privacyStats = {
    redactedFields: sanitized.stats.redactedFields + sanitizedMetadata.stats.redactedFields,
    truncatedFields: sanitized.stats.truncatedFields + sanitizedMetadata.stats.truncatedFields,
  };
  const diagnostics: RuntimeDiagnostic[] = [];
  if (privacyStats.redactedFields > 0)
    diagnostics.push({
      severity: "info",
      code: "privacy.redacted",
      message: `Redacted ${privacyStats.redactedFields} sensitive Claude hook fields.`,
      count: privacyStats.redactedFields,
    });
  if (privacyStats.truncatedFields > 0)
    diagnostics.push({
      severity: "info",
      code: "payload.truncated",
      message: `Truncated ${privacyStats.truncatedFields} oversized Claude hook fields.`,
      count: privacyStats.truncatedFields,
    });
  if (metadata.unsupported)
    diagnostics.push({
      severity: "info",
      code: "hook.unsupported",
      message: `Stored unsupported Claude hook event ${hookEvent}.`,
    });

  const architecture = ArchitectureGraphSchema.parse({
    id: `claude:${sessionId}`,
    title: titleBase,
    entities: [...entities.values()],
    edges: [...edges.values()],
  });
  const event = {
    id,
    traceId: stringValue(record.prompt_id) ?? sessionId,
    timestamp: 0,
    ...(durationMs === undefined ? {} : { durationMs }),
    category,
    action,
    sourceEntityId,
    targetEntityId,
    metadata: sanitizedMetadata.value as Record<string, unknown>,
  };
  const run = RunSchema.parse({
    id: sessionId,
    title: `${titleBase} · Claude Code`,
    prompt,
    startedAt: new Date(Number(metadata.absoluteStartMs)).toISOString(),
    ...(status === "running" ? {} : { endedAt: new Date(observedAt).toISOString() }),
    totalDurationMs: durationMs ?? 0,
    inputTokens: null,
    outputTokens: null,
    estimatedCostUsd: null,
    toolCallCount: ["tool", "mcp", "file", "web"].includes(category) ? 1 : 0,
    modelCallCount: 0,
    status,
    events: [event],
  });
  return {
    source: runtimeSources.claude,
    session: {
      id: sessionId,
      source: "claude",
      title: run.title,
      startedAt: run.startedAt,
      modifiedAt: new Date(observedAt).toISOString(),
      status: status === "running" ? "active" : status,
      eventCount: 1,
      ...(cwd ? { cwd } : {}),
    },
    architecture,
    run,
    rawEvents: { [id]: sanitized.value },
    diagnostics,
  };
}
