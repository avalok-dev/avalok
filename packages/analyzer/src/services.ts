import { posix } from "node:path";
import type {
  ArchitectureEvidence,
  ComposeAnalysis,
  DockerfileAnalysis,
  FileInventory,
  PackageManifest,
  ServiceUnit,
} from "./types";

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "root";

export const serviceId = (directory: string) =>
  `architecture:service:${
    directory === "."
      ? "root"
      : directory
          .split("/")
          .map((segment) => slug(segment))
          .join(":")
  }`;

export function serviceForPath(path: string, services: readonly ServiceUnit[]) {
  return services
    .filter(
      (service) =>
        service.directory === "." ||
        path === service.directory ||
        path.startsWith(`${service.directory}/`),
    )
    .sort((left, right) => right.directory.length - left.directory.length)[0];
}

function selectedManifests(manifests: readonly PackageManifest[]) {
  const node = manifests.filter((manifest) => manifest.ecosystem === "node");
  const nodeWorkspaces = node.filter((manifest) => manifest.isWorkspace);
  return [
    ...(nodeWorkspaces.length > 0
      ? nodeWorkspaces
      : node.filter((manifest) => manifest.directory === ".")),
    ...manifests.filter((manifest) => manifest.ecosystem === "python"),
  ];
}

function friendlyBase(directory: string, declaredName?: string) {
  const value =
    directory === "."
      ? (declaredName ?? "Repository Service")
      : (directory.split("/").at(-1) ?? declaredName ?? "Service");
  return value
    .replace(/^@[^/]+\//, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function discoverServices(
  inventory: FileInventory,
  manifests: PackageManifest[],
  dockerfiles: DockerfileAnalysis[],
  compose: ComposeAnalysis[],
) {
  const drafts = new Map<
    string,
    {
      declaredNames: string[];
      manifestPaths: string[];
      ecosystems: Set<"node" | "python" | "container">;
      composeServices: Set<string>;
      dockerfiles: Set<string>;
      ports: Set<number>;
      evidence: ArchitectureEvidence[];
    }
  >();
  const ensure = (directory: string) => {
    const normalized = posix.normalize(directory).replace(/^\.\//, "") || ".";
    const draft = drafts.get(normalized) ?? {
      declaredNames: [],
      manifestPaths: [],
      ecosystems: new Set<"node" | "python" | "container">(),
      composeServices: new Set<string>(),
      dockerfiles: new Set<string>(),
      ports: new Set<number>(),
      evidence: [],
    };
    drafts.set(normalized, draft);
    return { directory: normalized, draft };
  };

  for (const manifest of selectedManifests(manifests)) {
    const { draft } = ensure(manifest.directory);
    draft.declaredNames.push(manifest.name);
    draft.manifestPaths.push(manifest.path);
    draft.ecosystems.add(manifest.ecosystem);
    draft.evidence.push({
      kind: "workspace",
      file: manifest.path,
      description: `${manifest.ecosystem === "python" ? "Python project" : "Node workspace"} ${manifest.name}`,
      weight: 0.84,
    });
  }

  for (const composeFile of compose) {
    for (const service of composeFile.services) {
      if (!service.buildContext) continue;
      const { draft } = ensure(service.buildContext);
      draft.ecosystems.add("container");
      draft.composeServices.add(service.name);
      for (const port of service.ports) draft.ports.add(port.target);
      draft.evidence.push({
        kind: "compose-service",
        file: composeFile.path,
        description: `Compose service ${service.name} builds ${service.buildContext}`,
        weight: 0.78,
      });
    }
  }

  for (const dockerfile of dockerfiles) {
    const sourceInDirectory = inventory.files.some(
      (file) =>
        ["typescript", "javascript", "python"].includes(file.language ?? "") &&
        (dockerfile.directory === "." || file.path.startsWith(`${dockerfile.directory}/`)),
    );
    if (!sourceInDirectory) continue;
    const { draft } = ensure(dockerfile.directory);
    draft.ecosystems.add("container");
    draft.dockerfiles.add(dockerfile.path);
    for (const port of dockerfile.exposedPorts) draft.ports.add(port);
    draft.evidence.push({
      kind: "dockerfile",
      file: dockerfile.path,
      description: `${dockerfile.stages.length || 1}-stage container definition`,
      weight: 0.58,
    });
  }

  if (drafts.size === 0) {
    const hasSource = inventory.files.some((file) =>
      ["typescript", "javascript", "python"].includes(file.language ?? ""),
    );
    if (hasSource) {
      const { draft } = ensure(".");
      if (inventory.files.some((file) => file.language === "python"))
        draft.ecosystems.add("python");
      if (
        inventory.files.some((file) => ["typescript", "javascript"].includes(file.language ?? ""))
      )
        draft.ecosystems.add("node");
      const firstSource = inventory.files.find((file) => file.role === "source");
      if (firstSource)
        draft.evidence.push({
          kind: "source",
          file: firstSource.path,
          description: "Repository source root",
          weight: 0.62,
        });
    }
  }

  const provisional = [...drafts].map(([directory, draft]) => ({ directory, draft }));
  return provisional
    .map(({ directory, draft }): ServiceUnit => {
      const sourceFiles = inventory.files
        .filter((file) => ["typescript", "javascript", "python"].includes(file.language ?? ""))
        .filter((file) => {
          const owner = provisional
            .filter(
              (candidate) =>
                candidate.directory === "." ||
                file.path === candidate.directory ||
                file.path.startsWith(`${candidate.directory}/`),
            )
            .sort((left, right) => right.directory.length - left.directory.length)[0];
          return owner?.directory === directory;
        })
        .map((file) => file.path);
      const languages = [
        ...new Set(
          inventory.files
            .filter((file) => sourceFiles.includes(file.path))
            .flatMap((file) => (file.language ? [file.language] : [])),
        ),
      ];
      const declaredName = draft.declaredNames[0];
      return {
        id: serviceId(directory),
        directory,
        name: friendlyBase(directory, declaredName),
        ...(declaredName ? { declaredName } : {}),
        ...(draft.manifestPaths[0] ? { manifestPath: draft.manifestPaths[0] } : {}),
        ecosystems: [...draft.ecosystems],
        languages,
        sourceFiles,
        composeServices: [...draft.composeServices].sort(),
        dockerfiles: [...draft.dockerfiles].sort(),
        ports: [...draft.ports].sort((left, right) => left - right),
        evidence: draft.evidence,
      };
    })
    .sort((left, right) => left.directory.localeCompare(right.directory));
}
