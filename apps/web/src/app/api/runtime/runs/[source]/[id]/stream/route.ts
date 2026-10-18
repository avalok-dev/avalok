import {
  ClaudeTranscriptTail,
  resolveClaudeTranscript,
} from "@visual-system/claude-adapter/transcript";
import {
  deltaBetween,
  type RuntimeSnapshot,
  type RuntimeSourceKind,
} from "@visual-system/runtime-adapter";
import { LocalRuntimeStore } from "@visual-system/telemetry-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();
const message = (event: string, data: unknown) =>
  encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
const validSource = (value: string): value is RuntimeSourceKind =>
  value === "claude" || value === "telemetry";

export async function GET(
  request: Request,
  context: { params: Promise<{ source: string; id: string }> },
) {
  const { source, id } = await context.params;
  if (!validSource(source)) return Response.json({ error: "Unsupported source." }, { status: 404 });
  const store = new LocalRuntimeStore();
  const transcript = source === "claude" ? await resolveClaudeTranscript(id) : undefined;
  const tail = transcript ? new ClaudeTranscriptTail(transcript) : undefined;
  const load = async () => (tail ? tail.poll() : store.load(source, id));
  const initial = await load();
  if (!initial) return Response.json({ error: "Runtime run not found." }, { status: 404 });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let previous: RuntimeSnapshot = initial;
      let closed = false;
      controller.enqueue(message("snapshot", initial));
      const interval = setInterval(async () => {
        if (closed) return;
        try {
          const current = await load();
          if (!current) return;
          // The tail returns the same object until the transcript grows.
          if (
            tail ? current === previous : current.session.modifiedAt === previous.session.modifiedAt
          )
            return;
          const delta = deltaBetween(previous, current);
          previous = current;
          controller.enqueue(message("delta", delta));
        } catch (error) {
          controller.enqueue(
            message("adapter-error", {
              message: error instanceof Error ? error.message : "Runtime stream failed.",
            }),
          );
        }
      }, 500);
      const heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(": heartbeat\n\n"));
      }, 15_000);
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(interval);
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
