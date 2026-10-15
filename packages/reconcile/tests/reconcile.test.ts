import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { analyzeRepository } from "@visual-system/analyzer";
import type { ArchitectureGraph, RuntimeEvent } from "@visual-system/schema";
import { reconcileArchitectureExecution } from "../src/index";

const architecture: ArchitectureGraph = {
  id: "repo",
  title: "Repository",
  entities: [
    {
      id: "backend",
      kind: "service",
      name: "Backend API",
      provider: "FastAPI",
      metadata: {
        architecture: {
          category: "service",
          confidence: 1,
          confidenceLabel: "confirmed",
          evidence: [],
          directory: "backend",
          technologies: ["FastAPI", "Python"],
          sourceFiles: ["backend/app/main.py"],
          fileCount: 1,
          dependencies: [],
          runtimeNames: ["research-api", "api"],
          routes: [{ path: "/chat", methods: ["POST"], file: "backend/app/main.py" }],
        },
      },
    },
    {
      id: "replay",
      kind: "service",
      name: "Replay Engine",
      metadata: {
        architecture: {
          category: "package",
          confidence: 1,
          confidenceLabel: "confirmed",
          evidence: [],
          directory: "packages/replay",
          technologies: [],
          sourceFiles: ["packages/replay/src/engine.ts"],
          fileCount: 1,
          dependencies: [],
        },
      },
    },
    {
      id: "route-prompt",
      kind: "api",
      name: "/prompt",
      metadata: {
        architecture: {
          category: "route",
          confidence: 1,
          confidenceLabel: "confirmed",
          evidence: [],
          technologies: ["Next.js"],
          sourceFiles: ["apps/web/app/api/prompt/route.ts"],
          fileCount: 1,
          dependencies: [],
        },
      },
    },
    {
      id: "sqlite",
      kind: "database",
      name: "SQLite",
      provider: "sqlite",
      metadata: {
        architecture: {
          category: "integration",
          confidence: 0.9,
          confidenceLabel: "high",
          evidence: [],
          technologies: ["SQLite"],
          sourceFiles: [],
          fileCount: 0,
          dependencies: [],
        },
      },
    },
  ],
  edges: [],
};

const execution: ArchitectureGraph = {
  id: "run",
  title: "Run",
  entities: [
    { id: "codex", kind: "agent", name: "Codex" },
    { id: "files", kind: "storage", name: "Files" },
    { id: "terminal", kind: "tool", name: "Terminal" },
    { id: "mcp:github", kind: "mcp_server", name: "GitHub MCP" },
    { id: "model", kind: "model", name: "Model" },
  ],
  edges: [
    { id: "codex-files", source: "codex", target: "files" },
    { id: "codex-terminal", source: "codex", target: "terminal" },
  ],
};

describe("architecture/runtime reconciliation", () => {
  it("maps exact and workspace-owned runtime file paths", () => {
    const events: RuntimeEvent[] = [
      {
        id: "file",
        traceId: "run",
        timestamp: 10,
        category: "file",
        action: "files.changed",
        sourceEntityId: "codex",
        targetEntityId: "files",
        metadata: {
          files: ["packages/replay/src/engine.ts", "packages/replay/src/new-example.ts"],
        },
      },
    ];
    const result = reconcileArchitectureExecution(architecture, execution, events, {
      repositoryRoot: "/work/repo",
    });
    expect(result.matches.map((match) => match.matchType)).toEqual([
      "exact-source-path",
      "workspace-ownership",
    ]);
    expect(result.activities.replay).toMatchObject({ observed: true, eventCount: 1 });
    expect(result.events[0]?.metadata?.architectureEntityIds).toEqual(["replay"]);
    expect(
      result.graph.edges.some(
        (edge) => edge.target === "replay" && edge.kind === "runtime-observation",
      ),
    ).toBe(true);
  });

  it("preserves unknown files and unmatched external runtime entities", () => {
    const events: RuntimeEvent[] = [
      {
        id: "unknown",
        traceId: "run",
        timestamp: 10,
        category: "file",
        action: "files.changed",
        sourceEntityId: "codex",
        targetEntityId: "files",
        metadata: { files: ["outside/unknown.go"] },
      },
    ];
    const result = reconcileArchitectureExecution(architecture, execution, events);
    expect(result.unmatchedPaths).toEqual(["outside/unknown.go"]);
    expect(result.graph.entities.map((entity) => entity.id)).toEqual(
      expect.arrayContaining(["terminal", "mcp:github", "model"]),
    );
    expect(result.unmatchedRuntimeEntityIds).toEqual(
      expect.arrayContaining(["terminal", "mcp:github", "model"]),
    );
  });

  it("matches deterministic telemetry service, route, and database evidence", () => {
    const events: RuntimeEvent[] = [
      {
        id: "http",
        traceId: "trace",
        timestamp: 0,
        category: "http",
        action: "http.server",
        sourceEntityId: "codex",
        targetEntityId: "terminal",
        metadata: { serviceName: "replay", route: "/prompt" },
      },
      {
        id: "db",
        traceId: "trace",
        timestamp: 1,
        category: "database",
        action: "database.query",
        sourceEntityId: "codex",
        targetEntityId: "terminal",
        metadata: { dbSystem: "sqlite" },
      },
    ];
    const result = reconcileArchitectureExecution(architecture, execution, events);
    expect(result.matches.map((match) => match.matchType)).toEqual(
      expect.arrayContaining(["service-name", "http-route", "database-system"]),
    );
  });

  it("maps Python file paths and unique FastAPI service/route metadata", () => {
    const events: RuntimeEvent[] = [
      {
        id: "python-file",
        traceId: "python-trace",
        timestamp: 0,
        category: "agent",
        action: "agent.run",
        sourceEntityId: "codex",
        targetEntityId: "terminal",
        metadata: { file: "/work/repo/backend/app/main.py" },
      },
      {
        id: "python-http",
        traceId: "python-trace",
        timestamp: 1,
        category: "http",
        action: "http.server",
        sourceEntityId: "codex",
        targetEntityId: "terminal",
        metadata: { serviceName: "research-api", route: "/chat" },
      },
    ];
    const result = reconcileArchitectureExecution(architecture, execution, events, {
      repositoryRoot: "/work/repo",
    });
    expect(result.matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runtimeEventId: "python-file",
          architectureEntityId: "backend",
          matchType: "exact-source-path",
        }),
        expect.objectContaining({
          runtimeEventId: "python-http",
          architectureEntityId: "backend",
          matchType: "service-name",
        }),
      ]),
    );
    expect(result.events[1]?.metadata?.architectureEntityIds).toEqual(["backend"]);
  });

  it("reconciles the polyglot Python telemetry contract with the discovered backend", async () => {
    const root = fileURLToPath(new URL("../../../examples/polyglot-ai-platform", import.meta.url));
    const analysis = await analyzeRepository(root, { force: true });
    const backend = analysis.graph.entities.find((entity) => entity.name === "Backend API");
    const worker = analysis.graph.entities.find((entity) => entity.name === "Worker");
    expect(backend).toBeDefined();
    expect(worker).toBeDefined();
    const runtime: ArchitectureGraph = {
      id: "python-runtime",
      title: "Python runtime",
      entities: [
        { id: "research-api", kind: "service", name: "research-api" },
        { id: "research-worker", kind: "service", name: "research-worker" },
      ],
      edges: [],
    };
    const events: RuntimeEvent[] = [
      {
        id: "backend-span",
        traceId: "polyglot-trace",
        timestamp: 0,
        category: "agent",
        action: "Research agent",
        sourceEntityId: "research-api",
        metadata: {
          serviceName: "research-api",
          route: "/chat",
          file: "backend/app/main.py",
        },
      },
      {
        id: "worker-span",
        traceId: "polyglot-trace",
        timestamp: 1,
        category: "database",
        action: "Redis cache",
        sourceEntityId: "research-worker",
        metadata: { serviceName: "research-worker", file: "worker/tasks.py", dbSystem: "redis" },
      },
    ];
    const result = reconcileArchitectureExecution(analysis.graph, runtime, events, {
      repositoryRoot: root,
    });
    expect(result.events[0]?.metadata?.architectureEntityIds).toEqual(
      expect.arrayContaining([backend!.id]),
    );
    expect(result.events[1]?.metadata?.architectureEntityIds).toEqual(
      expect.arrayContaining([worker!.id]),
    );
    expect(result.matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ runtimeEventId: "backend-span", matchType: "exact-source-path" }),
        expect.objectContaining({ runtimeEventId: "worker-span", matchType: "exact-source-path" }),
      ]),
    );
  });

  it("adds direct deployment context without claiming activity on the cloud or cluster", () => {
    const deployedArchitecture: ArchitectureGraph = {
      ...architecture,
      entities: [
        ...architecture.entities,
        {
          id: "backend-deployment",
          kind: "workload",
          name: "Deployment · Backend",
          metadata: {
            architecture: {
              category: "infrastructure",
              confidence: 1,
              confidenceLabel: "confirmed",
              evidence: [],
              technologies: ["Kubernetes"],
              sourceFiles: ["deployment.yaml"],
              fileCount: 1,
              dependencies: [],
              infrastructureKind: "workload",
            },
          },
        },
        {
          id: "eks",
          kind: "cluster",
          name: "EKS",
          metadata: {
            architecture: {
              category: "infrastructure",
              confidence: 1,
              confidenceLabel: "confirmed",
              evidence: [],
              technologies: ["AWS"],
              sourceFiles: ["main.tf"],
              fileCount: 1,
              dependencies: [],
              infrastructureKind: "kubernetes-cluster",
            },
          },
        },
      ],
      edges: [
        {
          id: "backend-deployed",
          source: "backend",
          target: "backend-deployment",
          label: "deployed as",
          metadata: { architecture: { relationship: "deployed-as" } },
        },
        {
          id: "deployment-cluster",
          source: "backend-deployment",
          target: "eks",
          label: "runs on",
          metadata: { architecture: { relationship: "runs-on" } },
        },
      ],
    };
    const result = reconcileArchitectureExecution(deployedArchitecture, execution, [
      {
        id: "request",
        traceId: "trace",
        timestamp: 0,
        category: "http",
        action: "http.server",
        sourceEntityId: "codex",
        metadata: { serviceName: "research-api" },
      },
    ]);
    expect(result.events[0]?.metadata?.architectureEntityIds).toEqual([
      "backend",
      "backend-deployment",
    ]);
    expect(result.activities["backend-deployment"]).toMatchObject({ observed: true });
    expect(result.activities.eks).toMatchObject({ observed: false });
    expect(result.matches).toContainEqual(
      expect.objectContaining({
        architectureEntityId: "backend-deployment",
        matchType: "deployment-context",
      }),
    );
  });
});
