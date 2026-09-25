import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverCodexSessions } from "../src/index";

describe("continued session identity", () => {
  it("uses the concrete record id when files share a root session id", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-identities-"));
    await mkdir(join(root, "2026", "01", "01"), { recursive: true });
    await Promise.all(
      ["segment-a", "segment-b"].map((id) =>
        writeFile(
          join(root, "2026", "01", "01", `${id}.jsonl`),
          `${JSON.stringify({
            type: "session_meta",
            payload: { id, session_id: "shared-root", timestamp: "2026-01-01T00:00:00.000Z" },
          })}\n`,
        ),
      ),
    );

    const sessions = await discoverCodexSessions(root);
    expect(new Set(sessions.map((session) => session.id))).toEqual(
      new Set(["segment-a", "segment-b"]),
    );
  });
});
