import { beforeEach, describe, expect, test, vi } from "vitest";
import { createLogsSocket } from "./logsSocket";

// Same fake shape as terminalSocket.test.ts's FakeWebSocket -- kept
// separate (not shared) since each test file should be able to read its
// fixture standalone.
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = FakeWebSocket.CONNECTING;
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  close(): void {
    this.closed = true;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }

  simulateOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  simulateMessage(data: string): void {
    this.onmessage?.({ data });
  }
}

describe("createLogsSocket", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
  });

  function socketFactory() {
    return FakeWebSocket as unknown as typeof WebSocket;
  }

  test("connect builds the /ws/logs URL with project, session, service and token", () => {
    // Arrange
    const socket = createLogsSocket({
      baseUrl: "http://vpn-host:5309",
      token: "test-token",
      WebSocketImpl: socketFactory(),
    });

    // Act
    socket.connect("p1", "my-branch", "web");

    // Assert
    expect(FakeWebSocket.instances[0].url).toBe(
      "ws://vpn-host:5309/ws/logs?project=p1&session=my-branch&service=web&token=test-token",
    );
  });

  test("connect on an https baseUrl upgrades to wss", () => {
    const socket = createLogsSocket({
      baseUrl: "https://vpn-host",
      token: "test-token",
      WebSocketImpl: socketFactory(),
    });

    socket.connect("p1", "my-branch", "web");

    expect(FakeWebSocket.instances[0].url.startsWith("wss://vpn-host/ws/logs?")).toBe(true);
  });

  test("emits an open event when the underlying socket opens", () => {
    const socket = createLogsSocket({
      baseUrl: "http://vpn-host:5309",
      token: "test-token",
      WebSocketImpl: socketFactory(),
    });
    const onOpen = vi.fn();
    socket.on("open", onOpen);

    socket.connect("p1", "my-branch", "web");
    FakeWebSocket.instances[0].simulateOpen();

    expect(onOpen).toHaveBeenCalledOnce();
  });

  test("emits a data event with the raw text chunk on message", () => {
    const socket = createLogsSocket({
      baseUrl: "http://vpn-host:5309",
      token: "test-token",
      WebSocketImpl: socketFactory(),
    });
    const onData = vi.fn();
    socket.on("data", onData);

    socket.connect("p1", "my-branch", "web");
    FakeWebSocket.instances[0].simulateMessage("listening on :3000\n");

    expect(onData).toHaveBeenCalledWith("listening on :3000\n");
  });

  test("emits a close event when the underlying socket closes", () => {
    const socket = createLogsSocket({
      baseUrl: "http://vpn-host:5309",
      token: "test-token",
      WebSocketImpl: socketFactory(),
    });
    const onClose = vi.fn();
    socket.on("close", onClose);

    socket.connect("p1", "my-branch", "web");
    FakeWebSocket.instances[0].onclose?.();

    expect(onClose).toHaveBeenCalledOnce();
  });

  test("close closes the underlying socket", () => {
    const socket = createLogsSocket({
      baseUrl: "http://vpn-host:5309",
      token: "test-token",
      WebSocketImpl: socketFactory(),
    });

    socket.connect("p1", "my-branch", "web");
    socket.close();

    expect(FakeWebSocket.instances[0].closed).toBe(true);
  });

  test("has no send method -- this socket is read-only, mirroring LogsSocket.kt", () => {
    const socket = createLogsSocket({
      baseUrl: "http://vpn-host:5309",
      token: "test-token",
      WebSocketImpl: socketFactory(),
    });

    expect("send" in socket).toBe(false);
  });
});
