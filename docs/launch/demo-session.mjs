#!/usr/bin/env node
// Replays a scripted Claude Code session into a running Avalok, through the same hook endpoint
// Claude Code uses, so the real receiver, normalizer and store handle it. For recording the demo
// GIF and for screenshots: the session is always the same.
//
//   node docs/launch/demo-session.mjs <repository-folder> [otlp-port]
//
// The session claims to have run in <repository-folder>, so start Avalok on that same folder
// (see demo-recording.md). Event times are spread over about four minutes ending now, so the
// replay has realistic gaps without waiting. Nothing leaves your machine: it posts to 127.0.0.1.
import { resolve } from "node:path";

const [folder, port = "4318"] = process.argv.slice(2);
if (!folder) {
  console.error("Usage: node docs/launch/demo-session.mjs <repository-folder> [otlp-port]");
  process.exit(2);
}
const cwd = resolve(folder);
const endpoint = `http://127.0.0.1:${port}/v1/claude/hooks`;
const session_id = `demo-${Date.now().toString(36)}`;
const end = Date.now();
const start = end - 4 * 60_000;
const at = (seconds) => new Date(start + seconds * 1000).toISOString();
const file = (relative) => resolve(cwd, relative);

let step = 0;
const tool = (seconds, tool_name, tool_input, duration_ms, failed = false) => ({
  session_id,
  cwd,
  hook_event_name: failed ? "PostToolUseFailure" : "PostToolUse",
  prompt_id: "demo-prompt",
  tool_name,
  tool_use_id: `demo-tool-${(step += 1)}`,
  tool_input,
  duration_ms,
  ...(failed ? { error: "1 test failed" } : {}),
  receivedAt: at(seconds),
});

const events = [
  { session_id, cwd, hook_event_name: "SessionStart", receivedAt: at(0) },
  {
    session_id,
    cwd,
    hook_event_name: "UserPromptSubmit",
    prompt_id: "demo-prompt",
    prompt: "Make the chat endpoint retry when the model call fails",
    receivedAt: at(2),
  },
  tool(10, "Read", { file_path: file("backend/app/main.py") }, 40),
  tool(14, "Read", { file_path: file("backend/app/agent.py") }, 35),
  tool(28, "Edit", { file_path: file("backend/app/agent.py") }, 90),
  tool(40, "Edit", { file_path: file("worker/tasks.py") }, 70),
  tool(95, "Bash", { command: "pytest backend" }, 48_000, true),
  tool(110, "Read", { file_path: file("backend/app/db.py") }, 30),
  tool(135, "Edit", { file_path: file("backend/app/agent.py") }, 80),
  tool(200, "Bash", { command: "pytest backend" }, 52_000),
  {
    session_id,
    cwd,
    hook_event_name: "Stop",
    prompt_id: "demo-prompt",
    last_assistant_message: "Added retry with backoff to the agent call; tests pass.",
    receivedAt: at(236),
  },
];

for (const event of events) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
  }).catch((error) => {
    console.error(`Could not reach Avalok at ${endpoint}: ${error.message}`);
    console.error("Start it first: avalok <repository-folder> --no-open");
    process.exit(1);
  });
  if (!response.ok) {
    console.error(`Avalok rejected ${event.hook_event_name} (HTTP ${response.status}).`);
    process.exit(1);
  }
}
console.log(`Sent ${events.length} hook events for session ${session_id} in ${cwd}`);
