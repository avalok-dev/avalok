import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { normalizeClaudeHook } from "@visual-system/claude-adapter";
import {
  LocalRuntimeStore,
  normalizeTraces,
  parseOtlpJson,
  type TelemetryIngestionDiagnostics,
} from "@visual-system/telemetry-adapter";

export const DEFAULT_OTLP_HOST = "127.0.0.1";
export const DEFAULT_OTLP_PORT = 4318;
export const DEFAULT_MAX_BODY_BYTES = 5 * 1024 * 1024;

const loopbackHosts = new Set(["127.0.0.1", "::1", "localhost"]);

async function readBody(request: IncomingMessage, maximum: number) {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maximum) throw new RangeError(`Request body exceeds ${maximum} bytes.`);
    chunks.push(buffer);
  }
  const body = Buffer.concat(chunks);
  if (request.headers["content-encoding"] === "gzip") {
    const inflated = gunzipSync(body, { maxOutputLength: maximum });
    if (inflated.length > maximum)
      throw new RangeError(`Inflated request body exceeds ${maximum} bytes.`);
    return inflated;
  }
  return body;
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

export interface CollectorOptions {
  store?: LocalRuntimeStore;
  maxBodyBytes?: number;
}

export function createCollectorServer(options: CollectorOptions = {}) {
  const store = options.store ?? new LocalRuntimeStore();
  const maximum = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const diagnostics: TelemetryIngestionDiagnostics = {
    spansReceived: 0,
    spansNormalized: 0,
    unsupportedSpans: 0,
    malformedPayloads: 0,
    redactedFields: 0,
    truncatedFields: 0,
    activeServices: [],
  };
  const claudeDiagnostics = {
    hooksReceived: 0,
    normalized: 0,
    unsupported: 0,
    errors: 0,
    liveStatus: "listening" as const,
    lastReceivedAt: undefined as string | undefined,
  };
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/health") {
        json(response, 200, { status: "ok", diagnostics, claude: claudeDiagnostics });
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/traces") {
        const contentType = (request.headers["content-type"] ?? "").split(";")[0]?.trim();
        if (contentType !== "application/json") {
          json(response, 415, {
            error:
              "This milestone receiver accepts OTLP/HTTP JSON. Configure OTEL_EXPORTER_OTLP_PROTOCOL=http/json.",
          });
          return;
        }
        const body = await readBody(request, maximum);
        let payload: unknown;
        try {
          payload = JSON.parse(body.toString("utf8"));
        } catch {
          diagnostics.malformedPayloads += 1;
          json(response, 400, { error: "Malformed OTLP JSON payload." });
          return;
        }
        const parsed = parseOtlpJson(payload);
        diagnostics.spansReceived += parsed.spans.length + parsed.malformed;
        diagnostics.malformedPayloads += parsed.malformed;
        const snapshots = normalizeTraces(parsed.spans);
        for (const snapshot of snapshots) {
          await store.upsert(snapshot);
          diagnostics.spansNormalized += snapshot.run.events.length;
          if (
            snapshot.session.serviceName &&
            !diagnostics.activeServices.includes(snapshot.session.serviceName) &&
            diagnostics.activeServices.length < 100
          )
            diagnostics.activeServices.push(snapshot.session.serviceName);
          for (const item of snapshot.diagnostics) {
            if (item.code === "privacy.redacted") diagnostics.redactedFields += item.count ?? 0;
            if (item.code === "payload.truncated") diagnostics.truncatedFields += item.count ?? 0;
            if (item.code === "span.unsupported-openinference-kind")
              diagnostics.unsupportedSpans += item.count ?? 0;
          }
        }
        diagnostics.lastReceivedAt = new Date().toISOString();
        json(
          response,
          200,
          parsed.malformed > 0
            ? {
                partialSuccess: {
                  rejectedSpans: String(parsed.malformed),
                  errorMessage: "Malformed spans were ignored.",
                },
              }
            : {},
        );
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/claude/hooks") {
        claudeDiagnostics.hooksReceived += 1;
        try {
          const body = await readBody(request, maximum);
          let payload: unknown;
          try {
            payload = JSON.parse(body.toString("utf8"));
          } catch {
            throw new SyntaxError("Malformed Claude hook JSON payload.");
          }
          const snapshot = normalizeClaudeHook(payload);
          await store.upsert(snapshot);
          claudeDiagnostics.normalized += 1;
          claudeDiagnostics.unsupported += snapshot.diagnostics
            .filter((item) => item.code === "hook.unsupported")
            .reduce((total, item) => total + (item.count ?? 1), 0);
          claudeDiagnostics.lastReceivedAt = new Date().toISOString();
          json(response, 200, {});
          return;
        } catch (error) {
          claudeDiagnostics.errors += 1;
          json(response, error instanceof RangeError ? 413 : 400, {
            error: error instanceof Error ? error.message : "Claude hook request rejected.",
          });
          return;
        }
      }
      json(response, 404, { error: "Not found." });
    } catch (error) {
      if (error instanceof RangeError) {
        json(response, 413, { error: error.message });
        return;
      }
      json(response, 400, { error: error instanceof Error ? error.message : "Request rejected." });
    }
  });
}

export function collectorConfiguration(environment = process.env) {
  const host = environment.AGENTMAP_OTLP_HOST || DEFAULT_OTLP_HOST;
  const port = Number(environment.AGENTMAP_OTLP_PORT || DEFAULT_OTLP_PORT);
  if (!loopbackHosts.has(host) && environment.AGENTMAP_ALLOW_REMOTE_OTLP !== "1") {
    throw new Error("Refusing a non-loopback OTLP bind without AGENTMAP_ALLOW_REMOTE_OTLP=1.");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error("AGENTMAP_OTLP_PORT must be a valid TCP port.");
  return { host, port };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { host, port } = collectorConfiguration();
  createCollectorServer().listen(port, host, () => {
    process.stdout.write(`AgentMap collector listening on http://${host}:${port}\n`);
  });
}
