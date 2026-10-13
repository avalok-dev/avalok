import { productIdentity } from "./identity.ts";

export const cliDefaults = Object.freeze({
  host: "127.0.0.1",
  dashboardPort: 4737,
  otlpPort: 4318,
});

export interface CliOptions {
  command:
    | "start"
    | "doctor"
    | "data-path"
    | "data-clear"
    | "import-openai"
    | "setup-claude"
    | "setup-codex"
    | "recap"
    | "wrapped";
  target?: string;
  files?: string[];
  port: number;
  otlpPort: number;
  open: boolean;
  /** `avalok demo`: open the built-in demo first instead of analyzing a repository view. */
  demo?: boolean;
  /** `avalok setup claude --apply` / `--remove` */
  apply?: boolean;
  remove?: boolean;
  /** `avalok recap` and `avalok wrapped` settings. */
  recap?: RecapOptions;
  /** `avalok wrapped`: how many days back to look. */
  days?: number;
  help: boolean;
  version: boolean;
  yes: boolean;
}

export type RecapFormat = "md" | "svg" | "html" | "diagram";
export interface RecapOptions {
  /** `latest` (the newest session that ran in this repository) or a session id (`claude:<id>` or `codex:<id>` when two sources share one). */
  session: string;
  format: RecapFormat;
  out?: string;
  anonymize: boolean;
  brand: boolean;
  force: boolean;
}

export class CliUsageError extends Error {}

function port(value: string | undefined, option: string) {
  if (!value || !/^\d+$/.test(value))
    throw new CliUsageError(`${option} requires a TCP port number.`);
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535)
    throw new CliUsageError(`${option} must be between 1 and 65535.`);
  return parsed;
}

export function parseCliOptions(arguments_: string[]): CliOptions {
  const options: CliOptions = {
    command: "start",
    port: cliDefaults.dashboardPort,
    otlpPort: cliDefaults.otlpPort,
    open: true,
    demo: false,
    help: false,
    version: false,
    yes: false,
  };
  const input = [...arguments_];
  if (input[0] === "demo") {
    options.demo = true;
    input.shift();
  } else if (input[0] === "doctor") {
    options.command = "doctor";
    input.shift();
  } else if (input[0] === "data") {
    input.shift();
    const action = input.shift();
    if (action === "path") options.command = "data-path";
    else if (action === "clear") options.command = "data-clear";
    else throw new CliUsageError("Data requires either 'path' or 'clear'.");
  } else if (input[0] === "setup") {
    input.shift();
    const tool = input.shift();
    if (tool === "claude") options.command = "setup-claude";
    else if (tool === "codex") options.command = "setup-codex";
    else throw new CliUsageError("Setup requires 'claude' or 'codex'.");
  } else if (input[0] === "recap") {
    options.command = "recap";
    options.recap = {
      session: "latest",
      format: "md",
      anonymize: false,
      brand: true,
      force: false,
    };
    input.shift();
  } else if (input[0] === "wrapped") {
    options.command = "wrapped";
    options.days = 7;
    options.recap = {
      session: "latest",
      format: "svg",
      anonymize: false,
      brand: true,
      force: false,
    };
    input.shift();
  } else if (input[0] === "import") {
    input.shift();
    if (input.shift() !== "openai")
      throw new CliUsageError("Import requires 'openai' followed by saved trace pages.");
    options.command = "import-openai";
  }
  const positional: string[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const argument = input[index]!;
    if (argument === "--") {
      positional.push(...input.slice(index + 1));
      break;
    }
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--version" || argument === "-v") options.version = true;
    else if (argument === "--no-open") options.open = false;
    else if (argument === "--yes") options.yes = true;
    else if (argument === "--apply") options.apply = true;
    else if (argument === "--days" && options.command === "wrapped") {
      const value = input[++index];
      const days = Number(value);
      if (!value || !/^\d+$/.test(value) || days < 1 || days > 365)
        throw new CliUsageError("--days must be a whole number from 1 to 365.");
      options.days = days;
    } else if (argument === "--anonymize" && options.recap) options.recap.anonymize = true;
    else if (argument === "--no-brand" && options.recap) options.recap.brand = false;
    else if (argument === "--force" && options.recap) options.recap.force = true;
    else if (
      (argument === "--session" || argument === "--format" || argument === "--out") &&
      options.recap
    ) {
      const value = input[++index];
      if (!value || value.startsWith("--"))
        throw new CliUsageError(`${argument} requires a value.`);
      if (argument === "--session") options.recap.session = value;
      else if (argument === "--out") options.recap.out = value;
      else if (value === "md" || value === "svg" || value === "html" || value === "diagram")
        options.recap.format = value;
      else throw new CliUsageError("--format must be md, svg, html or diagram.");
    } else if (argument === "--remove") options.remove = true;
    else if (argument === "--port") options.port = port(input[++index], "--port");
    else if (argument.startsWith("--port="))
      options.port = port(argument.slice("--port=".length), "--port");
    else if (argument === "--otlp-port") options.otlpPort = port(input[++index], "--otlp-port");
    else if (argument.startsWith("--otlp-port="))
      options.otlpPort = port(argument.slice("--otlp-port=".length), "--otlp-port");
    else if (argument.startsWith("-")) throw new CliUsageError(`Unknown option: ${argument}`);
    else positional.push(argument);
  }
  if (options.command === "import-openai") {
    if (!positional.length && !options.help)
      throw new CliUsageError("Provide one or more saved OpenAI trace page files.");
    options.files = positional;
    return options;
  }
  if (positional.length > 1) throw new CliUsageError("Only one repository path may be provided.");
  if (
    options.command === "wrapped" &&
    options.recap &&
    !["svg", "md"].includes(options.recap.format)
  )
    throw new CliUsageError("wrapped supports --format svg or md.");
  if ((options.apply || options.remove) && options.command !== "setup-claude")
    throw new CliUsageError("--apply and --remove only apply to 'setup claude'.");
  if (options.apply && options.remove)
    throw new CliUsageError("Use either --apply or --remove, not both.");
  if (positional.length && options.demo)
    throw new CliUsageError("The demo does not need a repository path.");
  if (positional.length && options.command.startsWith("data-"))
    throw new CliUsageError("Data commands do not accept a repository path.");
  if (positional[0]) options.target = positional[0];
  return options;
}

export function helpText() {
  return `${productIdentity.displayName} ${productIdentity.version} — ${productIdentity.tagline}\n\nUsage:\n  ${productIdentity.cliName} [path] [options]\n  ${productIdentity.cliName} demo [options]        Open the built-in demo (needs no repository or agent session)\n  ${productIdentity.cliName} doctor [path] [options]\n  ${productIdentity.cliName} setup claude [path] [--apply | --remove]   Show (or, with --apply, add after confirming) the Claude Code hooks\n  ${productIdentity.cliName} setup codex       Codex needs no setup; shows what Avalok can read\n  ${productIdentity.cliName} wrapped [--days 7] [--format svg|md] [--out file]   A card of your agent week (counts only)\n  ${productIdentity.cliName} recap [path] [--format md|svg|html|diagram] [--out file]   Summarize the newest agent session that ran in this repository\n  ${productIdentity.cliName} data path\n  ${productIdentity.cliName} data clear [--yes]\n  ${productIdentity.cliName} import openai <page.json> [more-pages.json ...]\n\nOptions:\n  --port <port>       Dashboard port (default: ${cliDefaults.dashboardPort})\n  --otlp-port <port>  OTLP/HTTP port (default: ${cliDefaults.otlpPort})\n  --no-open           Do not open the dashboard in a browser\n  --yes               Confirm without asking (data clearing, setup --apply/--remove)\n  --apply             With 'setup claude': write the hooks after showing the change\n  --remove            With 'setup claude': remove Avalok's hooks\n  --session <id>      With 'recap': a session id from Codex, Claude Code or OpenTelemetry (default: the newest one that ran in the repository)\n  --format <kind>     With 'recap': md (default, printed), svg (recap card), html (interactive replay), diagram\n  --out <file>        With 'recap': write to this file (svg/html default to avalok-recap.<ext>)\n  --anonymize         With 'recap': replace names with generic labels\n  --no-brand          With 'recap' or 'wrapped': omit the 'Made with Avalok' footer\n  --days <n>          With 'wrapped': how many days back to include (default 7)\n  --force             With 'recap': overwrite an existing output file\n  --version           Print the CLI version\n  --help              Show this help\n\n${productIdentity.homepage}\n`;
}
