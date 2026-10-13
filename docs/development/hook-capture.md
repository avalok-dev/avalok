# Hook capture: Kiro and Cursor

Avalok does not yet understand Kiro or Cursor sessions. Both run a **command hook** for each agent event and pipe the event as JSON on stdin, but their exact event shapes are not documented well enough to write a normalizer from the docs alone. This page is how to capture **real** events from a real install so a normalizer can be written from facts. Nothing here changes what Avalok shows today.

## What exists

- `avalok hook <tool>` (`kiro` or `cursor`) is a tiny forwarder. It reads one event from stdin and posts it to the local collector at `127.0.0.1:4318` (`--otlp-port` changes the port). It **always exits 0, prints nothing, gives up after about 1.5 seconds, never returns an allow, deny or ask decision**, and contacts nothing but `127.0.0.1`.
- With `--capture` it also appends the event to a local file in Avalok's data directory: `<data directory>/captures/<tool>.jsonl` (`avalok data path` prints the directory). The file is private to you (mode 600), stops growing at 5 MB, and is removed by `avalok data clear`.
  - **Shape mode** (`--capture`, the default): field names and value types only. Strings become `<string:LENGTH>`; short identifier-like values are kept only under keys that name an event, tool, type or status (that is what a normalizer needs). Best effort: read the file before you share it.
  - **Raw mode** (`--capture-raw`): the event exactly as received. It can contain prompts, commands, file contents, paths and secrets. **Never share or commit a raw capture.** Use it only if shape mode is not enough, on a throwaway project.
- The collector counts these events (`/health`, field `hooks`) and stores nothing, because the formats are unverified.

## Why only some events

Agents treat hook output as part of their own control flow:

- **Cursor:** for permission events (`beforeShellExecution`, `beforeMCPExecution`, `beforeReadFile`, `beforeTabFileRead`, `subagentStart`, `preToolUse`), its documentation says an invalid or non-matching response blocks the action, and it does not say whether _empty_ output is accepted. Avalok prints nothing, so **do not register it on those events yet**. Use the `after*`/`post*` events below, which only report what already happened.
- **Kiro:** `PreToolUse` and `UserPromptSubmit` can be blocked by a hook's exit code, and output from some triggers may be added to the model's context (reported by a third party; not clearly documented). Avalok never blocks and prints nothing, but use only the observe-after triggers below until each behavior is confirmed.

(Documentation read 2026-10-13: [Cursor hooks](https://cursor.com/docs/hooks), [Kiro hooks](https://kiro.dev/docs/hooks/). Check them again before relying on this; both change.)

## Before you start

1. Install the build you want to test (`pnpm release:build --skip-smoke && npm install -g ./artifacts/release/avalok-*.tgz`), or use any installed `avalok`. Agents run hooks as a fresh process, so a global install matters: `npx` per event is too slow.
2. Find the **absolute path** of the command. GUI apps such as Cursor often do not see your shell's `PATH`.

   ```sh
   command -v avalok        # Windows: where avalok
   ```

   Use that full path in the snippets below (shown as `/ABSOLUTE/PATH/TO/avalok`; on Windows escape backslashes in JSON as `\\`).

3. Make a **throwaway project** folder with no real code or secrets, for example `mkdir ~/avalok-capture-test && cd ~/avalok-capture-test && git init`. Put the hook config **in that project**, not in your user settings, so it cannot affect your other work.
4. Optional: run `avalok` in that folder (`avalok --no-open`) so the collector counts events too. Captures work without it.

## Capture Cursor

Create `.cursor/hooks.json` **in the throwaway project** (Cursor's documentation describes project-level `hooks.json`; if events do not arrive, restart Cursor once):

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [{ "command": "/ABSOLUTE/PATH/TO/avalok hook cursor --capture" }],
    "postToolUse": [{ "command": "/ABSOLUTE/PATH/TO/avalok hook cursor --capture" }],
    "postToolUseFailure": [{ "command": "/ABSOLUTE/PATH/TO/avalok hook cursor --capture" }],
    "afterShellExecution": [{ "command": "/ABSOLUTE/PATH/TO/avalok hook cursor --capture" }],
    "afterMCPExecution": [{ "command": "/ABSOLUTE/PATH/TO/avalok hook cursor --capture" }],
    "afterFileEdit": [{ "command": "/ABSOLUTE/PATH/TO/avalok hook cursor --capture" }],
    "afterAgentResponse": [{ "command": "/ABSOLUTE/PATH/TO/avalok hook cursor --capture" }],
    "subagentStop": [{ "command": "/ABSOLUTE/PATH/TO/avalok hook cursor --capture" }],
    "stop": [{ "command": "/ABSOLUTE/PATH/TO/avalok hook cursor --capture" }],
    "sessionEnd": [{ "command": "/ABSOLUTE/PATH/TO/avalok hook cursor --capture" }]
  }
}
```

Open that folder in Cursor (the **IDE**, which is the primary target; the Cursor CLI reportedly sends fewer events) and give the agent the task in [the scripted task](#the-scripted-task).

## Capture Kiro

Create `.kiro/hooks/avalok-capture.json` **in the throwaway project**:

```json
{
  "version": "v1",
  "hooks": [
    {
      "name": "Avalok capture: SessionStart",
      "trigger": "SessionStart",
      "action": { "type": "command", "command": "/ABSOLUTE/PATH/TO/avalok hook kiro --capture" },
      "timeout": 10,
      "enabled": true
    },
    {
      "name": "Avalok capture: PostToolUse",
      "trigger": "PostToolUse",
      "action": { "type": "command", "command": "/ABSOLUTE/PATH/TO/avalok hook kiro --capture" },
      "timeout": 10,
      "enabled": true
    },
    {
      "name": "Avalok capture: PostFileSave",
      "trigger": "PostFileSave",
      "action": { "type": "command", "command": "/ABSOLUTE/PATH/TO/avalok hook kiro --capture" },
      "timeout": 10,
      "enabled": true
    },
    {
      "name": "Avalok capture: PostFileCreate",
      "trigger": "PostFileCreate",
      "action": { "type": "command", "command": "/ABSOLUTE/PATH/TO/avalok hook kiro --capture" },
      "timeout": 10,
      "enabled": true
    },
    {
      "name": "Avalok capture: Stop",
      "trigger": "Stop",
      "action": { "type": "command", "command": "/ABSOLUTE/PATH/TO/avalok hook kiro --capture" },
      "timeout": 10,
      "enabled": true
    }
  ]
}
```

Use the **Kiro CLI** first (the handoff's primary target) in the throwaway folder. If your Kiro version loads hooks from a different place or format (CLI 2.x agent configs predate this layout; Kiro's docs describe `/upgrade-agent`), say so when you report back instead of guessing; the configuration, not Avalok, is then what needs to change.

## The scripted task

Give the agent this prompt, exactly, in the throwaway project. It touches every kind of event without any real data:

> Create a file called notes.txt containing the words "hello capture". Then read it back. Then edit it to add a second line "second line". Run `echo capture-test` in the terminal. Then run a command that fails, `ls this-folder-does-not-exist`. Finish with a one-sentence summary.

If your install has an MCP server and a subagent, ask for one extra step that uses each (for example "list the files with the filesystem MCP tool"), since those are the events most likely to differ.

## Check what was captured

```sh
avalok data path                                   # the directory; captures are in its captures/ folder
node docs/development/hook-capture-summary.mjs "$(avalok data path)/captures/cursor.jsonl"
```

(From a clone of this repository; the helper only reads files.) It prints each kind of event, how many were seen, and the fields each carries. You should see, for example, a `sessionStart`, several `postToolUse`/`afterFileEdit`, an `afterShellExecution` for each command and a `stop`. If you see **no events**:

- the agent did not run the hook: check the config location, that hooks are enabled in that agent, and that the absolute path to `avalok` is right;
- or the hook ran and failed before Avalok: run `/ABSOLUTE/PATH/TO/avalok hook cursor --capture < /dev/null` by hand (it prints nothing and exits 0; `echo $?` shows `0`).

## What to send back

1. The summary output above for each tool, plus the **agent version** (Cursor: Help, About; Kiro: whatever its About screen or `--version` reports) and the operating system.
2. The shape files (`cursor.jsonl`, `kiro.jsonl`) after you have **read them**. They hold field names, types and event names, but they are best-effort: remove any line you do not want to share.
3. Whether any command or edit in the agent was **blocked, delayed or behaved differently** while the hook was registered. This answers the open question about empty hook output.
4. If a field's meaning is unclear from its name (a number, a nested object), one **hand-redacted** example for that single event. Do not send raw captures.

## Clean up

1. Delete the hook config (`.cursor/hooks.json`, `.kiro/hooks/avalok-capture.json`) or the whole throwaway project.
2. Remove the captures. `avalok data clear` removes them but **also** deletes Avalok's stored runs and settings; to remove only the captures, delete the `captures` folder inside the directory `avalok data path` prints.

## What happens next

Once real events are in hand, the next steps are: write a normalizer per tool in the collector (modeled on the Claude one), persist their runs so `recap`, `wrapped` and the landing work for them, and add `avalok setup kiro` / `avalok setup cursor` with the same safety rules as `avalok setup claude` (print by default, confirm, back up, idempotent, removable). None of that is started.
