import { createInterface } from "node:readline/promises";
import { agentMapDataPaths, clearAgentMapData, compactUserPath } from "@visual-system/capabilities";

export function dataPath(environment: NodeJS.ProcessEnv = process.env) {
  return agentMapDataPaths(environment);
}

export async function confirmDataClear(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
) {
  const readline = createInterface({ input, output });
  try {
    const answer = await readline.question(
      "This will delete AgentMap's local cache, observed runs, and UI settings.\nIt will NOT modify your repository, Codex sessions, or Claude sessions.\nContinue? [y/N] ",
    );
    return /^y(?:es)?$/i.test(answer.trim());
  } finally {
    readline.close();
  }
}

export async function runDataClear(options: {
  yes: boolean;
  environment?: NodeJS.ProcessEnv;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}) {
  const paths = dataPath(options.environment);
  const confirmed =
    options.yes ||
    (await confirmDataClear(options.input ?? process.stdin, options.output ?? process.stdout));
  if (!confirmed) return { cleared: false, message: "Cancelled. AgentMap data was not changed.\n" };
  await clearAgentMapData(paths);
  return {
    cleared: true,
    message: `Cleared AgentMap-owned data in ${compactUserPath(paths.root)}.\n`,
  };
}
