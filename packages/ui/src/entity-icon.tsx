import {
  Bot,
  BrainCircuit,
  Braces,
  AppWindow,
  CloudCog,
  Database,
  FileStack,
  Globe2,
  HardDrive,
  Network,
  PlugZap,
  Server,
  UserRound,
  Wrench,
} from "lucide-react";
import type { EntityKind } from "@visual-system/schema";

const icons = {
  user: UserRound,
  frontend: AppWindow,
  service: Server,
  agent: BrainCircuit,
  model: Bot,
  memory: Network,
  vector_database: Database,
  database: Database,
  tool: Wrench,
  mcp_server: PlugZap,
  web: Globe2,
  document: FileStack,
  api: CloudCog,
  queue: Network,
  storage: HardDrive,
  infrastructure: Server,
  cloud: CloudCog,
  network: Network,
  cluster: Network,
  namespace: FileStack,
  workload: Server,
  container: Server,
  gateway: Globe2,
  load_balancer: Network,
  function: Braces,
  config: FileStack,
  identity: UserRound,
} satisfies Record<EntityKind, typeof UserRound>;

export function EntityIcon({ kind, className }: { kind: EntityKind; className?: string }) {
  const Icon = icons[kind];
  return <Icon aria-hidden="true" className={className} strokeWidth={1.7} />;
}
