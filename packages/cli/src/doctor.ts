import { basename } from "node:path";
import { analyzeRepository } from "@visual-system/analyzer";
import {
  avalokDataPaths,
  buildCapabilityReport,
  checkDataDirectoryWritable,
  compactUserPath,
  inspectLegacyData,
  legacyDataSources,
  readMigrationFile,
  type CapabilityReport,
} from "@visual-system/capabilities";
import { resolveDashboardLayout } from "./dashboard.ts";
import { productIdentity } from "./identity.ts";
import { nodeSupport, supportedNodeRange, testedNodeLines } from "./node-support.ts";
import type { CliOptions } from "./options.ts";
import { isPortAvailable, resolveTarget } from "./system.ts";

export interface DoctorResult {
  exitCode: 0 | 1;
  output: string;
  report?: CapabilityReport;
}

const line = (state: "ok" | "warning" | "error", message: string) =>
  `${state === "ok" ? "✓" : state === "warning" ? "!" : "✗"} ${message}`;

async function avalokCollectorListening(endpoint: string) {
  try {
    const response = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(750) });
    const body = (await response.json()) as { status?: string };
    return response.ok && body.status === "ok";
  } catch {
    return false;
  }
}

async function legacyDataLines(
  paths: ReturnType<typeof avalokDataPaths>,
  environment: NodeJS.ProcessEnv,
  legacyHome?: string,
) {
  const file = await readMigrationFile(paths);
  const lines: string[] = [];
  for (const source of legacyDataSources(environment, process.platform, legacyHome)) {
    const [inspection, record] = [await inspectLegacyData(source), file.sources[source.key]];
    const label = source.label;
    if (record?.status === "completed") {
      lines.push(
        line(
          "ok",
          `Earlier AgentMap data migrated from ${label} (${record.copied} copied, ${record.skippedExisting} already present${record.settingsCopied ? ", settings copied" : ""})${inspection.present ? "; original kept" : ""}`,
        ),
      );
      continue;
    }
    if (!inspection.present) continue;
    if (environment.AVALOK_DATA_ROOT || environment.AVALOK_DATA_DIR)
      lines.push(
        line(
          "warning",
          `Earlier AgentMap data at ${label} (${inspection.snapshots} runs) is not migrated while AVALOK_DATA_DIR is set`,
        ),
      );
    else if (record?.status === "failed")
      lines.push(
        line(
          "warning",
          `Migration from ${label} failed: ${record.error ?? "unknown error"}; original untouched, retried on next start`,
        ),
      );
    else
      lines.push(
        line(
          "warning",
          `Earlier AgentMap data at ${label} (${inspection.snapshots} runs) will be copied on next start; the original is kept`,
        ),
      );
  }
  return lines.length ? lines : [line("ok", "No earlier AgentMap data to migrate")];
}

export async function runDoctor(
  options: CliOptions,
  configuration: { cwd?: string; environment?: NodeJS.ProcessEnv; legacyHome?: string } = {},
): Promise<DoctorResult> {
  const environment = configuration.environment ?? process.env;
  const sections: string[] = ["Avalok Doctor", "", "Version", line("ok", productIdentity.version)];
  const layout = resolveDashboardLayout(environment);
  sections.push(
    line(
      "ok",
      layout.kind === "packaged"
        ? "Installed package (bundled dashboard)"
        : "Source workspace (contributor mode)",
    ),
  );
  let blocking = false;
  sections.push("", "Runtime");
  const support = nodeSupport(process.versions.node);
  if (support === "supported")
    sections.push(line("ok", `Node ${process.versions.node} compatible`));
  else if (support === "untested")
    sections.push(
      line(
        "warning",
        `Node ${process.versions.node} is outside the tested lines (${testedNodeLines}); it may work`,
      ),
    );
  else {
    blocking = true;
    sections.push(
      line("error", `Node ${process.versions.node} unsupported; use ${supportedNodeRange}`),
    );
  }
  sections.push(line("ok", "pnpm is not required after Avalok starts"));

  let target: string;
  try {
    target = await resolveTarget(options.target, configuration.cwd);
    sections.push("", "Repository", line("ok", `${basename(target)} readable`));
  } catch (error) {
    return {
      exitCode: 1,
      output: [
        ...sections,
        "",
        "Repository",
        line("error", error instanceof Error ? error.message : "Repository unreadable"),
        "",
        "Result",
        "Blocked",
        "",
        "Safe to share: review the repository name before posting.",
        "",
      ].join("\n"),
    };
  }

  let analysis;
  try {
    analysis = await analyzeRepository(target);
    const languages = analysis.summary.languages
      .map(
        (item) =>
          `${item.language}${item.analysis === "inventory-only" ? " (inventory only)" : ""}`,
      )
      .join(", ");
    sections.push(line("ok", `Analyzer ready · ${analysis.metrics.architectureEntities} entities`));
    sections.push(line("ok", `Languages: ${languages || "none detected"}`));
    const configured = [
      analysis.metrics.terraformFiles && "Terraform",
      analysis.metrics.kubernetesDocuments && "Kubernetes",
      analysis.metrics.helmCharts && "Helm",
      analysis.metrics.dockerfilesParsed && "Docker",
      analysis.metrics.composeServices && "Compose",
      analysis.technologies.some((technology) => /aws/i.test(technology)) && "AWS (configured)",
    ]
      .filter(Boolean)
      .join(", ");
    sections.push(
      configured
        ? line("ok", `Configured architecture: ${configured}`)
        : line("warning", "No supported infrastructure configuration detected"),
    );
  } catch (error) {
    blocking = true;
    sections.push(
      line(
        "error",
        `Repository analyzer failed: ${error instanceof Error ? error.message : "unknown error"}`,
      ),
    );
    return {
      exitCode: 1,
      output: [
        ...sections,
        "",
        "Result",
        "Blocked",
        "",
        "Safe to share: review the repository name before posting.",
        "",
      ].join("\n"),
    };
  }

  const endpoint = `http://127.0.0.1:${options.otlpPort}`;
  const paths = avalokDataPaths(environment);
  const report = await buildCapabilityReport({
    analysis,
    target,
    endpoint,
    dataPaths: paths,
    environment,
  });
  sections.push("", "Sources");
  for (const source of report.sources.filter(
    (item) => item.id === "codex" || item.id === "claude",
  )) {
    const state =
      source.availability !== "available" || source.connection === "not-configured"
        ? "warning"
        : "ok";
    sections.push(line(state, `${source.label}: ${source.detail}`));
  }

  sections.push("", "Telemetry");
  sections.push(
    line("ok", "OTLP/HTTP protobuf and JSON accepted at /v1/traces (OTLP/gRPC not supported)"),
  );
  const otlpAvailable = await isPortAvailable(options.otlpPort, "127.0.0.1");
  if (otlpAvailable)
    sections.push(line("ok", `127.0.0.1:${options.otlpPort} available for the OTLP receiver`));
  else if (await avalokCollectorListening(endpoint))
    sections.push(line("ok", `Avalok OTLP receiver listening on 127.0.0.1:${options.otlpPort}`));
  else {
    blocking = true;
    sections.push(line("error", `OTLP port ${options.otlpPort} is occupied by another process`));
    sections.push("  Stop that process or run with --otlp-port <port>.");
  }
  const dashboardAvailable = await isPortAvailable(options.port, "127.0.0.1");
  sections.push(
    dashboardAvailable
      ? line("ok", `Dashboard port ${options.port} available`)
      : line(
          "warning",
          `Dashboard port ${options.port} occupied; startup will try the next local port`,
        ),
  );

  sections.push("", "Data");
  const writable = await checkDataDirectoryWritable(paths);
  if (!writable) blocking = true;
  sections.push(
    line(
      writable ? "ok" : "error",
      `${compactUserPath(paths.root)} ${writable ? "writable" : "not writable"}`,
    ),
  );
  sections.push(...(await legacyDataLines(paths, environment, configuration.legacyHome)));
  sections.push(
    "",
    "Security",
    line("ok", "Default dashboard and telemetry bindings are loopback-only"),
  );
  sections.push(
    "",
    "Result",
    blocking ? "Blocked" : "Ready",
    "",
    "Safe to share: no secrets or session contents are included; review repository and data-directory names before posting.",
    "",
  );
  return { exitCode: blocking ? 1 : 0, output: sections.join("\n"), report };
}
