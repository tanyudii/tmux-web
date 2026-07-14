export const HELP_TEXT = `tmuxweb - browser GUI for tmux sessions

Usage:
  tmuxweb                         Start the server (reads ~/.tmux-web/config.json)
  tmuxweb init                    Create ~/.tmux-web/config.json with a generated token
  tmuxweb generate                Regenerate the auth token
  tmuxweb config port <n>         Set the listen port
  tmuxweb config host <addr>      Set the bind host
  tmuxweb service install         Install as a systemd --user service
  tmuxweb service uninstall       Remove the systemd --user service
  tmuxweb service status          Show the systemd --user service status
  tmuxweb upgrade [--tag <tag>]   Upgrade the global install to a tag, or latest if omitted
  tmuxweb help                    Show this help
  tmuxweb --version               Print the installed version
`;

export function printHelp(): void {
  console.log(HELP_TEXT);
}
