import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { parse, resolve } from "node:path";

export class StartupError extends Error {
  constructor(
    message: string,
    readonly hint: string,
  ) {
    super(message);
  }
}

export async function resolveTarget(target: string | undefined, cwd = process.cwd()) {
  const requested = resolve(cwd, target ?? ".");
  let resolved: string;
  try {
    resolved = await realpath(requested);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new StartupError(
      code === "ENOENT"
        ? `Repository path does not exist: ${requested}`
        : `Repository path cannot be resolved: ${requested}`,
      "Check the path and its parent-directory permissions, then run again.",
    );
  }
  let details;
  try {
    details = await stat(resolved);
    await access(resolved, constants.R_OK);
  } catch {
    throw new StartupError(
      `Repository path is not readable: ${resolved}`,
      "Check repository permissions and run again.",
    );
  }
  if (!details.isDirectory())
    throw new StartupError(
      `Repository target must be a directory: ${resolved}`,
      "Pass a repository directory instead of a file.",
    );
  if (resolved === parse(resolved).root)
    throw new StartupError(
      "The filesystem root is too broad to analyze safely.",
      "Run Sarvadrik from a repository or pass its directory explicitly.",
    );
  return resolved;
}

export async function isPortAvailable(port: number, host: string) {
  return new Promise<boolean>((resolveAvailability) => {
    const probe = createServer();
    probe.unref();
    probe.once("error", () => resolveAvailability(false));
    probe.listen(port, host, () => probe.close(() => resolveAvailability(true)));
  });
}

export async function availableDashboardPort(preferred: number, host: string, attempts = 20) {
  for (
    let candidate = preferred;
    candidate < preferred + attempts && candidate <= 65_535;
    candidate += 1
  )
    if (await isPortAvailable(candidate, host)) return candidate;
  throw new StartupError(
    `No dashboard port is available from ${preferred} through ${Math.min(preferred + attempts - 1, 65_535)}.`,
    "Free one of those local ports or choose another with --port.",
  );
}

/**
 * The platform command that opens the dashboard. Pure so every platform is unit-testable.
 * Only a validated loopback http URL is ever passed, always as a single argv element, and no
 * shell is involved (Windows uses rundll32 rather than `cmd /c start`, which re-parses input).
 */
export function browserCommand(url: string, platform: NodeJS.Platform = process.platform) {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
    parsed.username ||
    parsed.password
  )
    throw new Error("Refusing to open a non-loopback dashboard URL.");
  const href = parsed.href;
  if (platform === "darwin") return { executable: "open", arguments: [href] };
  if (platform === "win32")
    return { executable: "rundll32.exe", arguments: ["url.dll,FileProtocolHandler", href] };
  return { executable: "xdg-open", arguments: [href] };
}

export async function openBrowser(url: string, platform: NodeJS.Platform = process.platform) {
  const command = browserCommand(url, platform);
  await new Promise<void>((resolveOpen, reject) => {
    const child = spawn(command.executable, command.arguments, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      shell: false,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolveOpen();
    });
  });
}
