import { main as startServer } from "../main.ts";
import { printHelp } from "./help.ts";
import { runInit } from "./init.ts";
import { runConfigCommand } from "./config-command.ts";
import { runUserCommand } from "./user-command.ts";
import { runServiceCommand } from "./service-command.ts";
import { runUpgrade } from "./upgrade.ts";
import { printVersion } from "./version.ts";
import { runMcpCommand } from "./mcp-command.ts";

// Overridable in tests so routing can be asserted without starting a real
// server or touching the filesystem/systemd -- mirrors the ServiceCommandDeps
// / UpgradeDeps injection pattern used elsewhere in this directory.
export interface RunCliDeps {
  startServer?: () => Promise<void>;
  printHelp?: () => void;
  runInit?: (args: string[]) => Promise<void>;
  runConfigCommand?: (args: string[]) => Promise<void>;
  runUserCommand?: (args: string[]) => Promise<void>;
  runServiceCommand?: (args: string[]) => Promise<void>;
  runUpgrade?: (args: string[]) => Promise<void>;
  runMcpCommand?: (args: string[]) => Promise<void>;
  printVersion?: () => void;
  exit?: (code: number) => void;
}

export async function runCli(argv: string[], deps: RunCliDeps = {}): Promise<void> {
  const [command, ...rest] = argv;
  const {
    startServer: start = startServer,
    printHelp: help = printHelp,
    runInit: init = runInit,
    runConfigCommand: config = runConfigCommand,
    runUserCommand: user = runUserCommand,
    runServiceCommand: service = runServiceCommand,
    runUpgrade: upgrade = runUpgrade,
    runMcpCommand: mcp = runMcpCommand,
    printVersion: version = printVersion,
    exit = (code: number) => process.exit(code),
  } = deps;

  switch (command) {
    case undefined:
      help();
      return;
    case "start":
      return start();
    case "init":
      return init(rest);
    case "config":
      return config(rest);
    case "user":
      return user(rest);
    case "service":
      return service(rest);
    case "upgrade":
      return upgrade(rest);
    case "mcp":
      return mcp(rest);
    case "help":
    case "-h":
    case "--help":
      help();
      return;
    case "--version":
    case "-v":
      version();
      return;
    default:
      console.error(`Unknown command: ${command}`);
      help();
      exit(1);
  }
}
