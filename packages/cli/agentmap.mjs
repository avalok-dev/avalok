#!/usr/bin/env node
import { register } from "tsx/esm/api";

register();

const { formatCliError, runCli } = await import("./src/bin.ts");

runCli().catch((error) => {
  process.stderr.write(formatCliError(error));
  process.exitCode = 1;
});
