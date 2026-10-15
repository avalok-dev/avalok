// Regenerates tests/fixtures/openinference-trace.otlp.pb with the official OpenTelemetry JS
// SDK protobuf serializer. Run: node --experimental-strip-types scripts/write-protobuf-fixture.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { sdkProtobufPayload } from "../tests/otel-sdk-fixture.ts";

writeFileSync(
  join(import.meta.dirname, "..", "tests", "fixtures", "openinference-trace.otlp.pb"),
  sdkProtobufPayload(),
);
