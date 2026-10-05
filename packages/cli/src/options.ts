import { productIdentity } from "./identity.ts";

export const cliDefaults = Object.freeze({
  host: "127.0.0.1",
  dashboardPort: 4737,
  otlpPort: 4318,
});

export interface CliOptions {
  command: "start" | "doctor" | "data-path" | "data-clear" | "import-openai";
  target?: string;
  files?: string[];
  port: number;
  otlpPort: number;
  open: boolean;
  help: boolean;
  version: boolean;
  yes: boolean;
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
    help: false,
    version: false,
    yes: false,
  };
  const input = [...arguments_];
  if (input[0] === "doctor") {
    options.command = "doctor";
    input.shift();
  } else if (input[0] === "data") {
    input.shift();
    const action = input.shift();
    if (action === "path") options.command = "data-path";
    else if (action === "clear") options.command = "data-clear";
    else throw new CliUsageError("Data requires either 'path' or 'clear'.");
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
  if (positional.length && options.command.startsWith("data-"))
    throw new CliUsageError("Data commands do not accept a repository path.");
  if (positional[0]) options.target = positional[0];
  return options;
}

export function helpText() {
  return `${productIdentity.displayName} ${productIdentity.version} — ${productIdentity.tagline}\n\nUsage:\n  ${productIdentity.cliName} [path] [options]\n  ${productIdentity.cliName} doctor [path] [options]\n  ${productIdentity.cliName} data path\n  ${productIdentity.cliName} data clear [--yes]\n  ${productIdentity.cliName} import openai <page.json> [more-pages.json ...]\n\nOptions:\n  --port <port>       Dashboard port (default: ${cliDefaults.dashboardPort})\n  --otlp-port <port>  OTLP/HTTP port (default: ${cliDefaults.otlpPort})\n  --no-open           Do not open the dashboard in a browser\n  --yes               Confirm Avalok-owned data clearing\n  --version           Print the CLI version\n  --help              Show this help\n\n${productIdentity.homepage}\n`;
}
