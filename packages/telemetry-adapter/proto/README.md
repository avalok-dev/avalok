# Vendored protocol definitions

- `opentelemetry/proto/**` — unmodified files from
  [open-telemetry/opentelemetry-proto](https://github.com/open-telemetry/opentelemetry-proto)
  tag `v1.11.0` (Apache-2.0): common, resource, trace, and the trace collector service.
- `google/rpc/status.proto` — the field layout of googleapis `google.rpc.Status` (Apache-2.0),
  which OTLP/HTTP uses for protobuf error bodies.

These files are the source of `src/otlp-proto-descriptor.ts`. Regenerate it after changing them:

```sh
pnpm --filter @visual-system/telemetry-adapter generate:otlp
```

A test fails if the checked-in descriptor drifts from these definitions. The descriptor is
compiled into the bundle; nothing reads `.proto` files at runtime.
