import { access, readFile, realpath } from "node:fs/promises";
import { dirname, join, parse } from "node:path";

async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function agentMapRepositoryRoot(start = process.cwd()) {
  let directory = await realpath(start);
  const filesystemRoot = parse(directory).root;
  while (directory !== filesystemRoot) {
    const workspaceFile = join(directory, "pnpm-workspace.yaml");
    const packageFile = join(directory, "package.json");
    if ((await exists(workspaceFile)) && (await exists(packageFile))) {
      try {
        const manifest = JSON.parse(await readFile(packageFile, "utf8")) as { name?: unknown };
        if (manifest.name === "ai-system-visualizer") return directory;
      } catch {
        // Continue upward if an unrelated package manifest is malformed.
      }
    }
    directory = dirname(directory);
  }
  throw new Error("Unable to locate the local AgentMap repository root.");
}

export async function targetRepositoryRoot() {
  const configured = process.env.AGENTMAP_TARGET_ROOT;
  return configured ? realpath(configured) : agentMapRepositoryRoot();
}

export const sampleRepositories = {
  fastapi: { sample: "python-fastapi", source: "packages/analyzer/tests/fixtures/python-fastapi" },
  polyglot: { sample: "polyglot-ai-platform", source: "examples/polyglot-ai-platform" },
  terraform: { sample: "terraform-aws", source: "packages/analyzer/tests/fixtures/terraform-aws" },
  kubernetes: {
    sample: "kubernetes-app",
    source: "packages/analyzer/tests/fixtures/kubernetes-app",
  },
  helm: { sample: "helm-app", source: "packages/analyzer/tests/fixtures/helm-app" },
  infrastructure: {
    sample: "infrastructure-ai-platform",
    source: "examples/infrastructure-ai-platform",
  },
} as const;

export type SampleRepository = keyof typeof sampleRepositories;

export function isSampleRepository(value: string): value is SampleRepository {
  return Object.hasOwn(sampleRepositories, value);
}

/**
 * Allowlisted sample repositories. An installed package ships them under the directory the
 * CLI passes as `AGENTMAP_SAMPLES_DIR`; contributor runs fall back to the source workspace.
 * Only fixed names map to fixed paths, so the browser can never choose an arbitrary path.
 */
export async function sampleRepositoryPath(
  name: SampleRepository,
  environment: Record<string, string | undefined> = process.env,
) {
  const entry = sampleRepositories[name];
  if (environment.AGENTMAP_SAMPLES_DIR) return join(environment.AGENTMAP_SAMPLES_DIR, entry.sample);
  return join(await agentMapRepositoryRoot(), entry.source);
}
