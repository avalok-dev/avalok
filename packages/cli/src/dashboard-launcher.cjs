// Packaged dashboard entry. Starts the Next.js standalone server, and exits if the AgentMap
// CLI that launched it disappears (force-killed, crashed, or a Windows console closed), so a
// server can never be orphaned holding the dashboard port. `process.kill(pid, 0)` only checks
// that the process exists, on every platform.
"use strict";
/* global process, require, setInterval */
const parent = Number(process.env.AGENTMAP_PARENT_PID);
if (Number.isInteger(parent) && parent > 0)
  setInterval(() => {
    try {
      process.kill(parent, 0);
    } catch {
      process.exit(0);
    }
  }, 1_000).unref();
// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS entry by design.
require("./server.js");
