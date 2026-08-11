import { beforeEach, describe, expect, test, vi } from "vitest";
import { createTerminalSocket } from "./terminalSocket";

// Minimal fake WebSocket, injectable the same way pty-bridge.ts's
// attachPtyToSocket takes a SpawnPtyFn -- lets us drive open/message/close
// deterministically without a real network connection.
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }

  // Test helper, not part of the real WebSocket API.
  simulateOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  simulateMessage(data: string): void {
    this.onmessage?.({ data });
  }
}

describe("createTerminalSocket", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
  });

  function socketFactory() {
    return FakeWebSocket as unknown as typeof WebSocket;
  }

  test("connect builds the /ws URL with session and token query params", () => {
    // Arrange
    const socket = createTerminalSocket({
      baseUrl: "http://vpn-host:5309",
      token: "test-token",
      WebSocketImpl: socketFactory(),
    });

    // Act
    socket.connect("proj--my-branch");

    // Assert
    const fake = FakeWebSocket.instances[0];
    expect(fake.url).toBe("ws://vpn-host:5309/ws?session=proj--my-branch&token=test-token");
  });

  test("connect on an https baseUrl upgrades to wss", () => {
    const socket = createTerminalSocket({
      baseUrl: "https://vpn-host",
      token: "test-token",
      WebSocketImpl: socketFactory(),
    });

    socket.connect("proj--my-branch");

    expect(FakeWebSocket.instances[0].url.startsWith("wss://vpn-host/ws?")).toBe(true);
  });

  test("connect with pane=1 appends the pane query param for the split viewport", () => {
    const socket = createTerminalSocket({
      baseUrl: "http://vpn-host:5309",
      token: "test-token",
      WebSocketImpl: socketFactory(),
    });

    socket.connect("proj--my-branch", 1);

    expect(FakeWebSocket.instances[0].url).toContain("pane=1");
  });

  test("connect without pane omits the pane query param", () => {
    const socket = createTerminalSocket({
      baseUrl: "http://vpn-host:5309",
      token: "test-token",
      WebSocketImpl: socketFactory(),
    });

    socket.connect("proj--my-branch");

    expect(FakeWebSocket.instances[0].url).not.toContain("pane=");
  });

  test("emits an open event when the underlying socket opens", () => {
    const socket = createTerminalSocket({
      baseUrl: "http://vpn-host:5309",
      token: "test-token",
      WebSocketImpl: socketFactory(),
    });
    const onOpen = vi.fn();
    socket.on("open", onOpen);

    socket.connect("proj--my-branch");
    FakeWebSocket.instances[0].simulateOpen();

    expect(onOpen).toHaveBeenCalledOnce();
  });

  test("emits a data event with raw PTY bytes on message, no envelope parsing", () => {
    const socket = createTerminalSocket({
      baseUrl: "http://vpn-host:5309",
      token: "test-token",
      WebSocketImpl: socketFactory(),
    });
    const onData = vi.fn();
    socket.on("data", onData);

    socket.connect("proj--my-branch");
    FakeWebSocket.instances[0].simulateMessage("$ echo hi\r\n");

    expect(onData).toHaveBeenCalledWith("$ echo hi\r\n");
  });

  test("emits a close event when the underlying socket closes", () => {
    const socket = createTerminalSocket({
      baseUrl: "http://vpn-host:5309",
      token: "test-token",
      WebSocketImpl: socketFactory(),
    });
    const onClose = vi.fn();
    socket.on("close", onClose);

    socket.connect("proj--my-branch");
    FakeWebSocket.instances[0].onclose?.();

    expect(onClose).toHaveBeenCalledOnce();
  });

  test("sendInput encodes the pty-bridge.ts wire format and sends immediately once open", () => {
    const socket = createTerminalSocket({
      baseUrl: "http://vpn-host:5309",
      token: "test-token",
      WebSocketImpl: socketFactory(),
    });

    socket.connect("proj--my-branch");
    FakeWebSocket.instances[0].simulateOpen();
    socket.sendInput("ls\n");

    expect(FakeWebSocket.instances[0].sent).toEqual([JSON.stringify({ type: "input", data: "ls\n" })]);
  });

  test("sendResize encodes cols/rows in the pty-bridge.ts wire format", () => {
    const socket = createTerminalSocket({
      baseUrl: "http://vpn-host:5309",
      token: "test-token",
      WebSocketImpl: socketFactory(),
    });

    socket.connect("proj--my-branch");
    FakeWebSocket.instances[0].simulateOpen();
    socket.sendResize(80, 24);

    expect(FakeWebSocket.instances[0].sent).toEqual([JSON.stringify({ type: "resize", cols: 80, rows: 24 })]);
  });

  test("sendScroll encodes direction/lines in the pty-bridge.ts wire format", () => {
    const socket = createTerminalSocket({
      baseUrl: "http://vpn-host:5309",
      token: "test-token",
      WebSocketImpl: socketFactory(),
    });

    socket.connect("proj--my-branch");
    FakeWebSocket.instances[0].simulateOpen();
    socket.sendScroll("up", 3);

    expect(FakeWebSocket.instances[0].sent).toEqual([JSON.stringify({ type: "scroll", direction: "up", lines: 3 })]);
  });

  // Regression coverage for the "resize sent before WebSocket open" race
  // documented in CLAUDE.md -- a resize fired immediately after connect()
  // (e.g. from fitAddon.fit() on mount) must not be silently dropped; it
  // has to be queued and flushed once the socket actually opens.
  test("a resize sent before open is cached and flushed once the socket opens, not dropped", () => {
    const socket = createTerminalSocket({
      baseUrl: "http://vpn-host:5309",
      token: "test-token",
      WebSocketImpl: socketFactory(),
    });

    socket.connect("proj--my-branch");
    socket.sendResize(80, 24); // fired before the fake socket ever opens
    expect(FakeWebSocket.instances[0].sent).toEqual([]); // not sent yet -- readyState isn't OPEN

    FakeWebSocket.instances[0].simulateOpen();

    expect(FakeWebSocket.instances[0].sent).toEqual([JSON.stringify({ type: "resize", cols: 80, rows: 24 })]);
  });

  test("only the latest pre-open resize is flushed, not every intermediate one", () => {
    const socket = createTerminalSocket({
      baseUrl: "http://vpn-host:5309",
      token: "test-token",
      WebSocketImpl: socketFactory(),
    });

    socket.connect("proj--my-branch");
    socket.sendResize(80, 24);
    socket.sendResize(100, 30);
    FakeWebSocket.instances[0].simulateOpen();

    expect(FakeWebSocket.instances[0].sent).toEqual([JSON.stringify({ type: "resize", cols: 100, rows: 30 })]);
  });

  test("input sent before open is queued in order and flushed on open", () => {
    const socket = createTerminalSocket({
      baseUrl: "http://vpn-host:5309",
      token: "test-token",
      WebSocketImpl: socketFactory(),
    });

    socket.connect("proj--my-branch");
    socket.sendInput("a");
    socket.sendInput("b");
    FakeWebSocket.instances[0].simulateOpen();

    expect(FakeWebSocket.instances[0].sent).toEqual([
      JSON.stringify({ type: "input", data: "a" }),
      JSON.stringify({ type: "input", data: "b" }),
    ]);
  });

  test("close closes the underlying socket", () => {
    const socket = createTerminalSocket({
      baseUrl: "http://vpn-host:5309",
      token: "test-token",
      WebSocketImpl: socketFactory(),
    });

    socket.connect("proj--my-branch");
    socket.close();

    expect(FakeWebSocket.instances[0].closed).toBe(true);
  });

  // Regression: reconnecting used to leave the previous socket open, so the
  // server kept a second `tmux attach-session` alive for the same session.
  // Both PTYs then streamed into the same terminal -- the "text suddenly
  // appears" symptom -- and tmux sized the session to the stale client.
  test("reconnecting closes the previous socket instead of leaving two attached", () => {
    const socket = createTerminalSocket({
      baseUrl: "http://vpn-host:5309",
      token: "test-token",
      WebSocketImpl: socketFactory(),
    });

    socket.connect("proj--my-branch");
    FakeWebSocket.instances[0].simulateOpen();
    socket.connect("proj--my-branch"); // reconnect / manual retry

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances[0].closed).toBe(true);
    expect(FakeWebSocket.instances[1].closed).toBe(false);
  });

  test("a superseded socket closing does not emit close (it must not drive reconnect state)", () => {
    const socket = createTerminalSocket({
      baseUrl: "http://vpn-host:5309",
      token: "test-token",
      WebSocketImpl: socketFactory(),
    });
    const closes: number[] = [];
    socket.on("close", () => closes.push(1));

    socket.connect("proj--my-branch");
    socket.connect("proj--my-branch"); // replaces the first; its close is ours, not a real drop

    expect(closes).toHaveLength(0);

    FakeWebSocket.instances[1].close(); // the *current* socket really dropping
    expect(closes).toHaveLength(1);
  });

  test("data from a superseded socket never reaches listeners", () => {
    const socket = createTerminalSocket({
      baseUrl: "http://vpn-host:5309",
      token: "test-token",
      WebSocketImpl: socketFactory(),
    });
    const received: string[] = [];
    socket.on("data", (text) => received.push(text));

    socket.connect("proj--my-branch");
    const stale = FakeWebSocket.instances[0];
    socket.connect("proj--my-branch");

    stale.simulateMessage("ghost output from the old attach");
    FakeWebSocket.instances[1].simulateMessage("real output");

    expect(received).toEqual(["real output"]);
  });
});
