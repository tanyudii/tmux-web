#!/usr/bin/env -S node --experimental-strip-types
import { runCli } from "../src/cli/index.ts";

runCli(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
