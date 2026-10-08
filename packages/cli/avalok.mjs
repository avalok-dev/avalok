#!/usr/bin/env node
import { register } from "tsx/esm/api";

register();

const { formatCliError, runCli } = await import("./src/bin.ts");

runCli()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(formatCliError(error));
    process.exitCode = 1;
  });
