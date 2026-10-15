import { stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const privacyNote =
  "Review the file before sharing it. It contains names of system parts, step counts and timings; it never contains prompts, commands, run titles or file paths, and secret-looking values are hidden. Nothing was uploaded.";

/**
 * Writes a shareable file the user asked for. Never overwrites without --force, never creates
 * folders, and reminds the user to review the file. Returns a process exit code.
 */
export async function writeShareable(options: {
  cwd: string;
  out: string | undefined;
  defaultName: string;
  content: string;
  label: string;
  force: boolean;
  output: { write(text: string): unknown };
  note?: string;
}) {
  const { output } = options;
  const path = resolve(options.cwd, options.out ?? options.defaultName);
  try {
    const parent = await stat(dirname(path));
    if (!parent.isDirectory()) throw new Error("not a directory");
  } catch {
    output.write(`Cannot write ${path}: its folder does not exist.\n`);
    return 1;
  }
  const exists = await stat(path).then(
    () => true,
    () => false,
  );
  if (exists && !options.force) {
    output.write(
      `${path} already exists. Choose another name with --out, or pass --force to replace it.\n`,
    );
    return 1;
  }
  await writeFile(path, options.content, "utf8");
  output.write(
    `Wrote the ${options.label}: ${path} (${(Buffer.byteLength(options.content) / 1024).toFixed(0)} KB)\n${options.note ?? privacyNote}\n`,
  );
  return 0;
}
