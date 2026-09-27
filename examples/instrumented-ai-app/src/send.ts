import { buildTracePayload, exportTrace } from "./telemetry.ts";

await exportTrace(
  buildTracePayload(process.argv.slice(2).join(" ") || "Explain the local fixture", {
    ...(process.env.OTEL_SERVICE_NAME ? { serviceName: process.env.OTEL_SERVICE_NAME } : {}),
  }),
);
process.stdout.write("Exported one deterministic OpenInference trace.\n");
