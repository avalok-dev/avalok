import { watch, type FSWatcher } from "node:fs";
import {
  CodexNormalizer,
  IncrementalJsonlReader,
  resolveSessionById,
} from "@visual-system/codex-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();
const message = (event: string, data: unknown) =>
  encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = await resolveSessionById(id);
  if (!session) return Response.json({ error: "Session not found." }, { status: 404 });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = new IncrementalJsonlReader();
      const normalizer = new CodexNormalizer(session);
      let closed = false;
      let pending = Promise.resolve();
      let sentDiagnosticCount = 0;

      const sendSnapshot = async () => {
        const batch = await reader.read(session.filePath);
        normalizer.addDiagnostics(batch.diagnostics);
        normalizer.ingest(batch.records);
        const result = normalizer.result();
        sentDiagnosticCount = result.diagnostics.length;
        const publicSession = Object.fromEntries(
          Object.entries(session).filter(([key]) => key !== "filePath"),
        );
        controller.enqueue(
          message("snapshot", {
            session: {
              ...publicSession,
              eventCount: result.run.events.length,
              status: result.run.status === "running" ? "active" : "completed",
            },
            architecture: result.architecture,
            run: result.run,
            rawEvents: result.rawEvents,
            diagnostics: result.diagnostics,
            cursor: batch.cursor,
          }),
        );
      };

      try {
        await sendSnapshot();
      } catch (error) {
        controller.enqueue(
          message("adapter-error", {
            message: error instanceof Error ? error.message : "Unable to read the session.",
          }),
        );
      }

      const watcher: FSWatcher = watch(session.filePath, { persistent: false }, () => {
        pending = pending
          .then(async () => {
            if (closed) return;
            const batch = await reader.read(session.filePath);
            if (batch.records.length === 0 && batch.diagnostics.length === 0) return;
            normalizer.addDiagnostics(batch.diagnostics);
            const events = normalizer.ingest(batch.records);
            const result = normalizer.result();
            const diagnostics = result.diagnostics.slice(sentDiagnosticCount);
            sentDiagnosticCount = result.diagnostics.length;
            const eventIds = new Set(events.map((event) => event.id));
            controller.enqueue(
              message("delta", {
                events,
                rawEvents: Object.fromEntries(
                  Object.entries(result.rawEvents).filter(([eventId]) => eventIds.has(eventId)),
                ),
                architecture: result.architecture,
                metrics: {
                  inputTokens: result.run.inputTokens,
                  outputTokens: result.run.outputTokens,
                  estimatedCostUsd: result.run.estimatedCostUsd,
                  toolCallCount: result.run.toolCallCount,
                  modelCallCount: result.run.modelCallCount,
                  status: result.run.status,
                  totalDurationMs: result.run.totalDurationMs,
                  endedAt: result.run.endedAt,
                },
                diagnostics,
                cursor: batch.cursor,
              }),
            );
          })
          .catch((error: unknown) => {
            if (!closed) {
              controller.enqueue(
                message("adapter-error", {
                  message: error instanceof Error ? error.message : "Live tailing failed.",
                }),
              );
            }
          });
      });
      const heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(": heartbeat\n\n"));
      }, 15_000);
      const close = () => {
        if (closed) return;
        closed = true;
        watcher.close();
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // The browser may already have closed its side of the stream.
        }
      };
      request.signal.addEventListener("abort", close, { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
