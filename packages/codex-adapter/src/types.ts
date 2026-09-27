import type { ArchitectureGraph, Run, RuntimeEvent } from "@visual-system/schema";
import type { RuntimeDiagnostic } from "@visual-system/runtime-adapter";

export type AdapterDiagnostic = RuntimeDiagnostic;

export interface CodexSessionSummary {
  id: string;
  fileName: string;
  filePath: string;
  startedAt: string | null;
  modifiedAt: string;
  bytes: number;
  lineCount: number | null;
  eventCount: number | null;
  cwd: string | null;
  originator: string | null;
  cliVersion: string | null;
  status: "active" | "completed" | "unknown";
}

export interface CodexSessionData {
  session: CodexSessionSummary;
  architecture: ArchitectureGraph;
  run: Run;
  rawEvents: Record<string, unknown>;
  diagnostics: AdapterDiagnostic[];
  cursor: number;
}

export interface CodexTailDelta {
  events: RuntimeEvent[];
  rawEvents: Record<string, unknown>;
  diagnostics: AdapterDiagnostic[];
  cursor: number;
}

export interface JsonlRecord {
  type?: unknown;
  timestamp?: unknown;
  ordinal?: unknown;
  payload?: unknown;
  [key: string]: unknown;
}
