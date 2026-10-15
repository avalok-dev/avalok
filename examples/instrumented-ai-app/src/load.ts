import { buildTracePayload, exportTrace } from "./telemetry.ts";

const requested = Number(
  process.argv.find((argument) => argument.startsWith("--count="))?.split("=")[1] ?? 1,
);
const count = Math.min(2_000, Math.max(1, Math.floor(requested)));
const requestedSpans = Number(
  process.argv.find((argument) => argument.startsWith("--spans="))?.split("=")[1] ?? 1_000,
);
const spans = Math.min(2_007, Math.max(7, Math.floor(requestedSpans)));
for (let index = 0; index < count; index += 1) {
  await exportTrace(
    buildTracePayload(`Load fixture ${index + 1}`, {
      startedAt: Date.now() + index,
      extraSpans: spans - 7,
    }),
  );
}
process.stdout.write(
  `Exported ${count} trace${count === 1 ? "" : "s"} (${count * spans} spans).\n`,
);
