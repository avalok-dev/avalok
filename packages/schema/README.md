# @visual-system/schema

Public, framework-independent Avalok schemas. This package provides the strict `avalok.run-export` v1 contract, its `RunExportV1` type, and `prepareRunExportV1` for explicit local export. It also exports Avalok's architecture and runtime data schemas.

```ts
import { RunExportV1Schema, prepareRunExportV1 } from "@visual-system/schema";
import type { RunExportV1 } from "@visual-system/schema";

const payload: RunExportV1 = prepareRunExportV1(run, graph, "demo");
RunExportV1Schema.parse(payload);
```

The ESM package version follows SemVer; the payload's `version: 1` is a separate wire-contract version. Consumers must reject unsupported payload versions. The v1 schema rejects unknown fields and enforces event sequence and entity references. Export preparation is local and makes no network request. Review the resulting behavioral data before sharing it.

The package is currently an unpublished prerelease candidate. Its manifest remains `private: true` until a separately approved publication process is in place. The checked-in package name is retained to preserve existing Avalok workspace imports; ownership of the `@visual-system` npm scope must be verified before publication.

See `docs/architecture/run-export-v1.md` in the public Avalok repository for the full field and privacy boundary.
