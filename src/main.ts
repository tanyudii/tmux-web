import { WebSocketServer, type WebSocket } from "ws";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createServer } from "./server.ts";
import { parseConfig, ConfigError } from "./config.ts";
import { listSessions, createSession, killSession, isValidSessionName } from "./tmux.ts";
import { extractQueryToken, verifyToken } from "./auth.ts";
import { attachPtyToSocket, type SocketLike } from "./pty-bridge.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "public");
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

function main(): void {
  let config;
  try {
    config = parseConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`Configuration error: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }

  const httpServer = createServer({
    token: config.token,
    listSessions,
    createSession,
    killSession,
    publicDir: PUBLIC_DIR,
  });

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "", "http://localhost");

    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }

    const sessionName = url.searchParams.get("session") ?? "";
    const token = extractQueryToken(req.url ?? "");

    if (!isValidSessionName(sessionName) || !verifyToken(token, config.token)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      attachPtyToSocket(ws as unknown as WebSocket & SocketLike, sessionName, DEFAULT_COLS, DEFAULT_ROWS);
    });
  });

  httpServer.listen(config.port, config.bindHost, () => {
    console.log(`tmux-web listening on http://${config.bindHost}:${config.port}`);
  });
}

main();
