import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FitAddonLike, SearchAddonLike, TerminalLike } from "../terminal/types";
import { createPushStore, type PushStore } from "../stores/pushStore";
import { TerminalScreen } from "./TerminalScreen";

function fakeTerminal(): TerminalLike {
  return {
    cols: 80,
    rows: 24,
    options: { fontSize: 14 },
    open: vi.fn(),
    write: vi.fn(),
    onData: vi.fn(),
    onBell: vi.fn(),
    resize: vi.fn(),
    loadAddon: vi.fn(),
    dispose: vi.fn(),
    focus: vi.fn(),
    hasSelection: vi.fn().mockReturnValue(false),
    getSelection: vi.fn().mockReturnValue(""),
    clearSelection: vi.fn(),
  };
}

function fakeFitAddon(): FitAddonLike {
  return { fit: vi.fn() };
}

function fakeSearchAddon(): SearchAddonLike {
  return { findNext: vi.fn().mockReturnValue(true), findPrevious: vi.fn().mockReturnValue(true), clearActiveDecoration: vi.fn() };
}

type Listener = (...args: unknown[]) => void;

function fakeSocket() {
  const listeners: Record<string, Listener[]> = { open: [], data: [], close: [] };
  return {
    on: vi.fn((event: string, listener: Listener) => {
      listeners[event].push(listener);
    }),
    off: vi.fn(),
    connect: vi.fn(),
    sendInput: vi.fn(),
    sendResize: vi.fn(),
    sendScroll: vi.fn(),
    close: vi.fn(),
    emit(event: string, ...args: unknown[]) {
      for (const listener of listeners[event]) listener(...args);
    },
  };
}

function fakeLogsSocket() {
  return { on: vi.fn(), off: vi.fn(), connect: vi.fn(), close: vi.fn() };
}

function fakeApi(overrides: Record<string, unknown> = {}) {
  return {
    getChanges: vi.fn().mockResolvedValue({ staged: [], unstaged: [], untracked: [], conflicted: [], repoState: "clean" }),
    getDiff: vi.fn(),
    stageFile: vi.fn(),
    unstageFile: vi.fn(),
    discardFile: vi.fn(),
    commitChanges: vi.fn(),
    getPasteBuffer: vi.fn().mockResolvedValue("copied text"),
    getEnvStatus: vi.fn().mockResolvedValue({ phase: "unavailable" }),
    startEnv: vi.fn().mockResolvedValue(undefined),
    stopEnv: vi.fn().mockResolvedValue(undefined),
    cancelEnv: vi.fn().mockResolvedValue(undefined),
    listEnvFiles: vi.fn().mockResolvedValue([]),
    readEnvFile: vi.fn().mockResolvedValue(""),
    writeEnvFile: vi.fn().mockResolvedValue(undefined),
    getPushPublicKey: vi.fn().mockResolvedValue("vapid-key"),
    subscribePush: vi.fn().mockResolvedValue(undefined),
    unsubscribePush: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// Push toggle rendering/behavior itself is covered by
// PushNotificationToggle.test.tsx and pushStore.test.tsx -- most tests here
// just need a real store instance to satisfy the required prop, unsupported
// by default so it never adds an unexpected button to assertions that don't
// care about it.
function fakePushStore(overrides: Partial<Parameters<typeof createPushStore>[0]> = {}): PushStore {
  return createPushStore({
    api: fakeApi() as never,
    isBrowserPushSupported: () => false,
    ...overrides,
  });
}

describe("TerminalScreen", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("connects the terminal socket to the given session and navigates back via the nav bar", () => {
    const socket = fakeSocket();
    const onBack = vi.fn();
    render(() => (
      <TerminalScreen
        api={fakeApi() as never}
        baseUrl="https://tmux.example.com"
        token="tok"
        projectId="proj"
        sessionFullName="proj__build"
        sessionName="build"
        projectName="my-project"
        onBack={onBack}
        pushStore={fakePushStore()}
        createSocket={() => socket as never}
        createTerminal={fakeTerminal}
        createFitAddon={fakeFitAddon}
        createSearchAddon={fakeSearchAddon}
      />
    ));

    expect(socket.connect).toHaveBeenCalledWith("proj__build", 0);

    fireEvent.click(screen.getByRole("button", { name: /my-project/ }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("shows a reconnecting banner on socket close and hides it again once reopened", async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    render(() => (
      <TerminalScreen
        api={fakeApi() as never}
        baseUrl="https://tmux.example.com"
        token="tok"
        projectId="proj"
        sessionFullName="proj__build"
        sessionName="build"
        projectName="my-project"
        onBack={vi.fn()}
        pushStore={fakePushStore()}
        createSocket={() => socket as never}
        createTerminal={fakeTerminal}
        createFitAddon={fakeFitAddon}
        createSearchAddon={fakeSearchAddon}
      />
    ));

    socket.emit("close");
    expect(screen.getByText("Reconnecting…")).toBeInTheDocument();

    socket.emit("open");
    expect(screen.queryByText("Reconnecting…")).toBeNull();
  });

  it("shows a live badge count of pending changes and opens the Changes dialog", async () => {
    const api = fakeApi({
      getChanges: vi.fn().mockResolvedValue({
        staged: [{ path: "a.ts", status: "modified", staged: true, conflicted: false }],
        unstaged: [],
        untracked: [],
        conflicted: [],
        repoState: "clean",
      }),
    });
    render(() => (
      <TerminalScreen
        api={api as never}
        baseUrl="https://tmux.example.com"
        token="tok"
        projectId="proj"
        sessionFullName="proj__build"
        sessionName="build"
        projectName="my-project"
        onBack={vi.fn()}
        pushStore={fakePushStore()}
        createSocket={() => fakeSocket() as never}
        createTerminal={fakeTerminal}
        createFitAddon={fakeFitAddon}
        createSearchAddon={fakeSearchAddon}
      />
    ));

    expect(await screen.findByText("1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "View changes" }));

    expect(await screen.findByText(/Staged \(1\)/)).toBeInTheDocument();
  });

  it("renders the quick keys bar wired to the same input path", () => {
    const socket = fakeSocket();
    render(() => (
      <TerminalScreen
        api={fakeApi() as never}
        baseUrl="https://tmux.example.com"
        token="tok"
        projectId="proj"
        sessionFullName="proj__build"
        sessionName="build"
        projectName="my-project"
        onBack={vi.fn()}
        pushStore={fakePushStore()}
        createSocket={() => socket as never}
        createTerminal={fakeTerminal}
        createFitAddon={fakeFitAddon}
        createSearchAddon={fakeSearchAddon}
      />
    ));

    fireEvent.click(screen.getByRole("button", { name: "Esc" }));

    expect(socket.sendInput).toHaveBeenCalledWith("\x1b");
  });

  it("shows the environment toggle once status resolves, and Run calls startEnv", async () => {
    const api = fakeApi({ getEnvStatus: vi.fn().mockResolvedValue({ phase: "idle" }) });
    render(() => (
      <TerminalScreen
        api={api as never}
        baseUrl="https://tmux.example.com"
        token="tok"
        projectId="proj"
        sessionFullName="proj__build"
        sessionName="build"
        projectName="my-project"
        onBack={vi.fn()}
        pushStore={fakePushStore()}
        createSocket={() => fakeSocket() as never}
        createTerminal={fakeTerminal}
        createFitAddon={fakeFitAddon}
        createSearchAddon={fakeSearchAddon}
      />
    ));

    fireEvent.click(await screen.findByRole("button", { name: "Run environment" }));

    expect(api.startEnv).toHaveBeenCalledWith("proj", "build");
  });

  it("Edit config opens the EnvFileEditorDialog -- diverges from the Kotlin original, which never wires this on mobile", async () => {
    const api = fakeApi({ getEnvStatus: vi.fn().mockResolvedValue({ phase: "idle" }) });
    render(() => (
      <TerminalScreen
        api={api as never}
        baseUrl="https://tmux.example.com"
        token="tok"
        projectId="proj"
        sessionFullName="proj__build"
        sessionName="build"
        projectName="my-project"
        onBack={vi.fn()}
        pushStore={fakePushStore()}
        createSocket={() => fakeSocket() as never}
        createTerminal={fakeTerminal}
        createFitAddon={fakeFitAddon}
        createSearchAddon={fakeSearchAddon}
      />
    ));

    fireEvent.click(await screen.findByRole("button", { name: "Edit environment config" }));

    expect(await screen.findByText(".tmux-web-env")).toBeInTheDocument();
    expect(api.listEnvFiles).toHaveBeenCalledWith("proj", "build");
  });

  it("Stop environment shows a confirm, and confirming calls stopEnv", async () => {
    const api = fakeApi({
      getEnvStatus: vi.fn().mockResolvedValue({ phase: "running", services: [{ service: "app", state: "running" }] }),
    });
    render(() => (
      <TerminalScreen
        api={api as never}
        baseUrl="https://tmux.example.com"
        token="tok"
        projectId="proj"
        sessionFullName="proj__build"
        sessionName="build"
        projectName="my-project"
        onBack={vi.fn()}
        pushStore={fakePushStore()}
        createSocket={() => fakeSocket() as never}
        createTerminal={fakeTerminal}
        createFitAddon={fakeFitAddon}
        createSearchAddon={fakeSearchAddon}
      />
    ));

    fireEvent.click(await screen.findByText("1/1"));
    fireEvent.click(await screen.findByText("Stop environment"));
    expect(await screen.findByText("Stop environment?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));

    expect(api.stopEnv).toHaveBeenCalledWith("proj", "build");
  });

  it("clicking a service's logs icon opens LogsDialog and connects the logs socket", async () => {
    const logsSocket = fakeLogsSocket();
    const api = fakeApi({
      getEnvStatus: vi.fn().mockResolvedValue({ phase: "running", services: [{ service: "app", state: "running" }] }),
    });
    render(() => (
      <TerminalScreen
        api={api as never}
        baseUrl="https://tmux.example.com"
        token="tok"
        projectId="proj"
        sessionFullName="proj__build"
        sessionName="build"
        projectName="my-project"
        onBack={vi.fn()}
        pushStore={fakePushStore()}
        createSocket={() => fakeSocket() as never}
        createLogsSocket={() => logsSocket as never}
        createTerminal={fakeTerminal}
        createFitAddon={fakeFitAddon}
        createSearchAddon={fakeSearchAddon}
      />
    ));

    fireEvent.click(await screen.findByText("1/1"));
    fireEvent.click(await screen.findByRole("button", { name: "View app logs" }));

    expect(await screen.findByText("Logs: app")).toBeInTheDocument();
    expect(logsSocket.connect).toHaveBeenCalledWith("proj", "build", "app");
  });

  it("renders the push toggle in the nav bar and wires clicks through to the shared store -- diverges from the Kotlin original, which never renders this control on mobile", async () => {
    const api = fakeApi();
    const pushStore = fakePushStore({
      api: api as never,
      isBrowserPushSupported: () => true,
      subscribeBrowserPush: async () => ({ endpoint: "https://push.example.com/a", keys: { p256dh: "p", auth: "a" } }),
    });
    render(() => (
      <TerminalScreen
        api={api as never}
        baseUrl="https://tmux.example.com"
        token="tok"
        projectId="proj"
        sessionFullName="proj__build"
        sessionName="build"
        projectName="my-project"
        onBack={vi.fn()}
        pushStore={pushStore}
        createSocket={() => fakeSocket() as never}
        createTerminal={fakeTerminal}
        createFitAddon={fakeFitAddon}
        createSearchAddon={fakeSearchAddon}
      />
    ));

    fireEvent.click(await screen.findByRole("button", { name: "Enable push notifications" }));

    expect(await screen.findByRole("button", { name: "Disable push notifications" })).toBeInTheDocument();
    expect(api.subscribePush).toHaveBeenCalled();
  });
});
