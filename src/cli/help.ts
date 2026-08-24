export const HELP_TEXT = `tmuxweb - browser GUI for tmux sessions

Usage:
  tmuxweb                         Show this help (same as \`tmuxweb help\`)
  tmuxweb start                   Start the server (reads ~/.tmux-web/config.json)
  tmuxweb init                    Create ~/.tmux-web/config.json
  tmuxweb config port <n>         Set the listen port
  tmuxweb config host <addr>      Set the bind host
  tmuxweb user add <username> <password>
                                  Create a user account
  tmuxweb user list               List user accounts
  tmuxweb user remove <username>  Delete a user account
  tmuxweb service install         Install as a systemd --user service
  tmuxweb service uninstall       Remove the systemd --user service
  tmuxweb service status          Show the systemd --user service status
  tmuxweb upgrade [--tag <tag>] [--app-dir <path>]
                                  Upgrade (or bootstrap) the install to a tag, latest if omitted
  tmuxweb mcp                     Start the MCP server (stdio, local subprocess use)
  tmuxweb mcp --http [--host <addr>] [--port <n>]
                                  Start the MCP server over HTTP instead (remote/VPN use,
                                  default host 127.0.0.1, default port 5311)
  tmuxweb help                    Show this help
  tmuxweb --version               Print the installed version
`;

export function printHelp(): void {
  console.log(HELP_TEXT);
}
