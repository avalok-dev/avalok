import { createServer } from "node:http";
import { buildTracePayload, exportTrace } from "./telemetry.ts";

const host = "127.0.0.1";
const port = Number(process.env.EXAMPLE_APP_PORT || 4319);
const collector =
  process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || "http://127.0.0.1:4318/v1/traces";

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${host}:${port}`);
  if (request.method === "POST" && url.pathname === "/prompt") {
    const chunks: Buffer[] = [];
    for await (const chunk of request)
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString("utf8");
    const prompt = body ? (JSON.parse(body) as { prompt?: string }).prompt : undefined;
    await exportTrace(
      buildTracePayload(prompt, {
        ...(process.env.OTEL_SERVICE_NAME ? { serviceName: process.env.OTEL_SERVICE_NAME } : {}),
        ...(typeof request.headers["x-sarvadrik-fake-secret"] === "string"
          ? { authorization: request.headers["x-sarvadrik-fake-secret"] }
          : {}),
      }),
      collector,
    );
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({ response: "Deterministic local response", telemetry: "exported" }),
    );
    return;
  }
  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "POST /prompt" }));
}).listen(port, host, () => {
  process.stdout.write(`Instrumented example listening on http://${host}:${port}\n`);
});
