import { open } from "node:fs/promises";
import type { AdapterDiagnostic, JsonlRecord } from "./types";

export interface JsonlBatch {
  records: Array<{ record: JsonlRecord; line: number }>;
  diagnostics: AdapterDiagnostic[];
  cursor: number;
}

export class IncrementalJsonlReader {
  private cursor: number;
  private remainder = Buffer.alloc(0);
  private line = 0;

  constructor(cursor = 0) {
    this.cursor = Math.max(0, cursor);
  }

  get offset() {
    return this.cursor;
  }

  async read(filePath: string): Promise<JsonlBatch> {
    const file = await open(filePath, "r");
    try {
      const stat = await file.stat();
      if (stat.size < this.cursor) {
        this.cursor = 0;
        this.remainder = Buffer.alloc(0);
        this.line = 0;
      }
      const length = stat.size - this.cursor;
      if (length <= 0) return { records: [], diagnostics: [], cursor: this.cursor };
      const buffer = Buffer.alloc(length);
      const result = await file.read(buffer, 0, length, this.cursor);
      this.cursor += result.bytesRead;
      return this.consume(buffer.subarray(0, result.bytesRead));
    } finally {
      await file.close();
    }
  }

  consume(chunk: Buffer | string): JsonlBatch {
    const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const combined = Buffer.concat([this.remainder, incoming]);
    const records: Array<{ record: JsonlRecord; line: number }> = [];
    const diagnostics: AdapterDiagnostic[] = [];
    let start = 0;

    for (let index = 0; index < combined.length; index += 1) {
      if (combined[index] !== 10) continue;
      this.line += 1;
      const text = combined.subarray(start, index).toString("utf8").trim();
      start = index + 1;
      if (!text) continue;
      try {
        const value: unknown = JSON.parse(text);
        if (typeof value === "object" && value !== null && !Array.isArray(value)) {
          records.push({ record: value as JsonlRecord, line: this.line });
        } else {
          diagnostics.push({
            severity: "warning",
            code: "jsonl.non_object",
            message: "Ignored a JSONL value that was not an object.",
            line: this.line,
          });
        }
      } catch {
        diagnostics.push({
          severity: "warning",
          code: "jsonl.malformed",
          message: "Ignored a malformed JSONL record.",
          line: this.line,
        });
      }
    }

    this.remainder = combined.subarray(start);
    return { records, diagnostics, cursor: this.cursor };
  }
}
