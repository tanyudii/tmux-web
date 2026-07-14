import { main as startServer } from "../main.ts";
import { printHelp } from "./help.ts";
import { runInit } from "./init.ts";
import { runGenerate } from "./generate-token.ts";
import { runConfigCommand } from "./config-command.ts";
import { runServiceCommand } from "./service-command.ts";
import { runUpgrade } from "./upgrade.ts";
import { printVersion } from "./version.ts";

export async function runCli(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;

  switch (command) {
    case undefined:
      return startServer();
    case "init":
      return runInit(rest);
    case "generate":
      return runGenerate(rest);
    case "config":
      return runConfigCommand(rest);
    case "service":
      return runServiceCommand(rest);
    case "upgrade":
      return runUpgrade(rest);
    case "help":
    case "-h":
    case "--help":
      printHelp();
      return;
    case "--version":
    case "-v":
      printVersion();
      return;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}
