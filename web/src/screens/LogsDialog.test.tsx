import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogsStore } from "../stores/logsStore";
import { LogsDialog } from "./LogsDialog";

const SERVICES = [
  { service: "app", state: "running" },
  { service: "db", state: "starting" },
];

function fakeSocket() {
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = { open: [], data: [], close: [] };
  return {
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listeners[event].push(listener);
    }),
    off: vi.fn(),
    connect: vi.fn(),
    close: vi.fn(),
    emit(event: "open" | "data" | "close", ...args: unknown[]) {
      for (const l of listeners[event]) l(...args);
    },
  };
}

describe("LogsDialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("connects to the selected service on mount and renders arriving output lines", async () => {
    const socket = fakeSocket();
    const store = createLogsStore({ projectId: "p", sessionSlug: "s", socket });
    render(() => <LogsDialog selectedService="app" services={SERVICES} store={store} onDismiss={vi.fn()} onSwitchService={vi.fn()} />);

    expect(socket.connect).toHaveBeenCalledWith("p", "s", "app");
    expect(screen.getByText("Logs: app")).toBeInTheDocument();
    expect(screen.getByText("disconnected")).toBeInTheDocument();

    socket.emit("open");
    expect(await screen.findByText("live")).toBeInTheDocument();

    socket.emit("data", "starting server...\n");
    expect(await screen.findByText("starting server...")).toBeInTheDocument();
  });

  it("opens the service switcher and switching calls both onSwitchService and store.switchService", async () => {
    const socket = fakeSocket();
    const store = createLogsStore({ projectId: "p", sessionSlug: "s", socket });
    const onSwitchService = vi.fn();
    render(() => <LogsDialog selectedService="app" services={SERVICES} store={store} onDismiss={vi.fn()} onSwitchService={onSwitchService} />);

    fireEvent.click(screen.getByText("Logs: app"));
    expect(screen.getByText("db")).toBeInTheDocument();

    fireEvent.click(screen.getByText("db"));

    expect(onSwitchService).toHaveBeenCalledWith("db");
    expect(socket.connect).toHaveBeenLastCalledWith("p", "s", "db");
  });

  it("Close dialog calls onDismiss and disposes the socket", async () => {
    const socket = fakeSocket();
    const store = createLogsStore({ projectId: "p", sessionSlug: "s", socket });
    const onDismiss = vi.fn();
    const { unmount } = render(() => (
      <LogsDialog selectedService="app" services={SERVICES} store={store} onDismiss={onDismiss} onSwitchService={vi.fn()} />
    ));

    fireEvent.click(screen.getByRole("button", { name: "Close logs" }));
    expect(onDismiss).toHaveBeenCalledOnce();

    unmount();
    expect(socket.close).toHaveBeenCalled();
  });
});
