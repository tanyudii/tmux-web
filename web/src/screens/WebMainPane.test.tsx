import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FitAddonLike, SearchAddonLike, TerminalLike } from "../terminal/types";
import { createPushStore, type PushStore } from "../stores/pushStore";
import { WebMainPane } from "./WebMainPane";

const PROJECT = { id: "p1", name: "app-a", repoPath: "/repos/a", createdAt: "2026-01-01T00:00:00Z" };
const SESSION = { name: "build", fullName: "p1__build", windows: 2, windowNames: ["main", "logs"], attached: true, label: null, favorite: false };
const OTHER_SESSION = { name: "worker", fullName: "p1__worker", windows: 1, windowNames: ["shell"], attached: false, label: null, favorite: false };

function fakeTerminal(): TerminalLike {
  return {
    cols: 80,
    rows: 24,
    modes: { mouseTrackingMode: "none" as const },
    parser: { registerOscHandler: vi.fn() },
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
    paste: vi.fn(),
  };
}
const fakeFitAddon = (): FitAddonLike => ({ fit: vi.fn() });
const fakeSearchAddon = (): SearchAddonLike => ({
  findNext: vi.fn().mockReturnValue(true),
  findPrevious: vi.fn().mockReturnValue(true),
  clearActiveDecoration: vi.fn(),
});

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
    getPasteBuffer: vi.fn().mockResolvedValue(""),
    getSessionResourceUsage: vi.fn().mockResolvedValue({ available: false, services: [] }),
    getEnvStatus: vi.fn().mockResolvedValue({ phase: "unavailable" }),
    startEnv: vi.fn().mockResolvedValue(undefined),
    stopEnv: vi.fn().mockResolvedValue(undefined),
    cancelEnv: vi.fn().mockResolvedValue(undefined),
    listEnvFiles: vi.fn().mockResolvedValue([]),
    readEnvFile: vi.fn().mockResolvedValue(""),
    writeEnvFile: vi.fn().mockResolvedValue(undefined),
    listSessions: vi.fn().mockResolvedValue([SESSION]),
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

describe("WebMainPane", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows a generic empty state when nothing is selected", () => {
    const onNewSession = vi.fn();
    render(() => (
      <WebMainPane
        api={fakeApi() as never}
        baseUrl="https://tmux.example.com"
        token="tok"
        project={null}
        session={null}
        projectId={null}
        onNewSession={onNewSession}
        onSessionEnded={vi.fn()}
        pushStore={fakePushStore()}
      />
    ));

    expect(screen.getByText("Select a session")).toBeInTheDocument();
  });

  it("shows a project-specific empty state with a New session action when a project has no session selected", () => {
    const onNewSession = vi.fn();
    render(() => (
      <WebMainPane
        api={fakeApi() as never}
        baseUrl="https://tmux.example.com"
        token="tok"
        project={PROJECT}
        session={null}
        projectId="p1"
        onNewSession={onNewSession}
        onSessionEnded={vi.fn()}
        pushStore={fakePushStore()}
      />
    ));

    expect(screen.getByText("No session selected in app-a")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    expect(onNewSession).toHaveBeenCalledOnce();
  });

  it("mounts the terminal and window tabs once a session is selected", () => {
    const socket = fakeSocket();
    render(() => (
      <WebMainPane
        api={fakeApi() as never}
        baseUrl="https://tmux.example.com"
        token="tok"
        project={PROJECT}
        session={SESSION}
        projectId="p1"
        onNewSession={vi.fn()}
        onSessionEnded={vi.fn()}
        pushStore={fakePushStore()}
        createSocket={() => socket as never}
        createTerminal={fakeTerminal}
        createFitAddon={fakeFitAddon}
        createSearchAddon={fakeSearchAddon}
      />
    ));

    expect(socket.connect).toHaveBeenCalledWith("p1__build", 0);
    expect(screen.getByText("app-a / build")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "0: main" })).toBeInTheDocument();
  });

  it("shows a reconnecting banner on socket close and hides it again once reopened (task #33 fix -- desktop previously had no banner at all)", () => {
    const socket = fakeSocket();
    render(() => (
      <WebMainPane
        api={fakeApi() as never}
        baseUrl="https://tmux.example.com"
        token="tok"
        project={PROJECT}
        session={SESSION}
        projectId="p1"
        onNewSession={vi.fn()}
        onSessionEnded={vi.fn()}
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

  it("toggles the changes rail visibility", () => {
    const socket = fakeSocket();
    const { container } = render(() => (
      <WebMainPane
        api={fakeApi() as never}
        baseUrl="https://tmux.example.com"
        token="tok"
        project={PROJECT}
        session={SESSION}
        projectId="p1"
        onNewSession={vi.fn()}
        onSessionEnded={vi.fn()}
        pushStore={fakePushStore()}
        createSocket={() => socket as never}
        createTerminal={fakeTerminal}
        createFitAddon={fakeFitAddon}
        createSearchAddon={fakeSearchAddon}
      />
    ));

    // Starts CLOSED: opening a session should hand the pane to the terminal,
    // not to the git changes panel. This assertion is inverted from what it was
    // -- the rail used to default open, which is what put a changes panel in
    // front of every freshly created session.
    expect(container.querySelector(".tw-changes-rail")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Toggle changes" }));
    expect(container.querySelector(".tw-changes-rail")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Toggle changes" }));
    expect(container.querySelector(".tw-changes-rail")).toBeNull();
  });

  it("shows the environment toggle once status resolves, and Run calls startEnv", async () => {
    const socket = fakeSocket();
    const api = fakeApi({ getEnvStatus: vi.fn().mockResolvedValue({ phase: "idle" }) });
    render(() => (
      <WebMainPane
        api={api as never}
        baseUrl="https://tmux.example.com"
        token="tok"
        project={PROJECT}
        session={SESSION}
        projectId="p1"
        onNewSession={vi.fn()}
        onSessionEnded={vi.fn()}
        pushStore={fakePushStore()}
        createSocket={() => socket as never}
        createTerminal={fakeTerminal}
        createFitAddon={fakeFitAddon}
        createSearchAddon={fakeSearchAddon}
      />
    ));

    fireEvent.click(await screen.findByRole("button", { name: "Run environment" }));

    expect(api.startEnv).toHaveBeenCalledWith("p1", "build");
  });

  it("Edit config opens the EnvFileEditorDialog", async () => {
    const socket = fakeSocket();
    const api = fakeApi({ getEnvStatus: vi.fn().mockResolvedValue({ phase: "idle" }) });
    render(() => (
      <WebMainPane
        api={api as never}
        baseUrl="https://tmux.example.com"
        token="tok"
        project={PROJECT}
        session={SESSION}
        projectId="p1"
        onNewSession={vi.fn()}
        onSessionEnded={vi.fn()}
        pushStore={fakePushStore()}
        createSocket={() => socket as never}
        createTerminal={fakeTerminal}
        createFitAddon={fakeFitAddon}
        createSearchAddon={fakeSearchAddon}
      />
    ));

    fireEvent.click(await screen.findByRole("button", { name: "Edit environment config" }));

    expect(await screen.findByText(".tmux-web-env")).toBeInTheDocument();
    expect(api.listEnvFiles).toHaveBeenCalledWith("p1", "build");
  });

  it("Stop environment shows a confirm, and confirming calls stopEnv", async () => {
    const socket = fakeSocket();
    const api = fakeApi({
      getEnvStatus: vi.fn().mockResolvedValue({ phase: "running", services: [{ service: "app", state: "running" }] }),
    });
    render(() => (
      <WebMainPane
        api={api as never}
        baseUrl="https://tmux.example.com"
        token="tok"
        project={PROJECT}
        session={SESSION}
        projectId="p1"
        onNewSession={vi.fn()}
        onSessionEnded={vi.fn()}
        pushStore={fakePushStore()}
        createSocket={() => socket as never}
        createTerminal={fakeTerminal}
        createFitAddon={fakeFitAddon}
        createSearchAddon={fakeSearchAddon}
      />
    ));

    fireEvent.click(await screen.findByText("1/1"));
    fireEvent.click(await screen.findByText("Stop environment"));
    expect(await screen.findByText("Stop environment?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));

    expect(api.stopEnv).toHaveBeenCalledWith("p1", "build");
  });

  it("clicking a service's logs icon opens LogsDialog and connects the logs socket", async () => {
    const socket = fakeSocket();
    const logsSocket = fakeLogsSocket();
    const api = fakeApi({
      getEnvStatus: vi.fn().mockResolvedValue({ phase: "running", services: [{ service: "app", state: "running" }] }),
    });
    render(() => (
      <WebMainPane
        api={api as never}
        baseUrl="https://tmux.example.com"
        token="tok"
        project={PROJECT}
        session={SESSION}
        projectId="p1"
        onNewSession={vi.fn()}
        onSessionEnded={vi.fn()}
        pushStore={fakePushStore()}
        createSocket={() => socket as never}
        createLogsSocket={() => logsSocket as never}
        createTerminal={fakeTerminal}
        createFitAddon={fakeFitAddon}
        createSearchAddon={fakeSearchAddon}
      />
    ));

    fireEvent.click(await screen.findByText("1/1"));
    fireEvent.click(await screen.findByRole("button", { name: "View app logs" }));

    expect(await screen.findByText("Logs: app")).toBeInTheDocument();
    expect(logsSocket.connect).toHaveBeenCalledWith("p1", "build", "app");
  });

  it("renders the push toggle in the topbar and wires clicks through to the shared store", async () => {
    const socket = fakeSocket();
    const api = fakeApi();
    const pushStore = fakePushStore({
      api: api as never,
      isBrowserPushSupported: () => true,
      subscribeBrowserPush: async () => ({ endpoint: "https://push.example.com/a", keys: { p256dh: "p", auth: "a" } }),
    });
    render(() => (
      <WebMainPane
        api={api as never}
        baseUrl="https://tmux.example.com"
        token="tok"
        project={PROJECT}
        session={SESSION}
        projectId="p1"
        onNewSession={vi.fn()}
        onSessionEnded={vi.fn()}
        pushStore={pushStore}
        createSocket={() => socket as never}
        createTerminal={fakeTerminal}
        createFitAddon={fakeFitAddon}
        createSearchAddon={fakeSearchAddon}
      />
    ));

    fireEvent.click(await screen.findByRole("button", { name: "Enable push notifications" }));

    expect(await screen.findByRole("button", { name: "Disable push notifications" })).toBeInTheDocument();
    expect(api.subscribePush).toHaveBeenCalled();
  });

  it("switching sessions disposes the old session's terminal socket (SessionPane remount)", () => {
    const firstSocket = fakeSocket();
    const secondSocket = fakeSocket();
    let socketCallCount = 0;
    const createSocket = () => (socketCallCount++ === 0 ? firstSocket : secondSocket) as never;
    const [session, setSession] = createSignal(SESSION);

    render(() => (
      <WebMainPane
        api={fakeApi() as never}
        baseUrl="https://tmux.example.com"
        token="tok"
        project={PROJECT}
        session={session()}
        projectId="p1"
        onNewSession={vi.fn()}
        onSessionEnded={vi.fn()}
        pushStore={fakePushStore()}
        createSocket={createSocket}
        createTerminal={fakeTerminal}
        createFitAddon={fakeFitAddon}
        createSearchAddon={fakeSearchAddon}
      />
    ));
    expect(firstSocket.connect).toHaveBeenCalledWith("p1__build", 0);

    // WebMainPane's outer Show is keyed on session.fullName -- switching to
    // a different session fully unmounts and rebuilds SessionPane, the same
    // real-world path a user hits by clicking a different session in the
    // sidebar. The old socket must be closed, not leaked.
    setSession(OTHER_SESSION);

    expect(firstSocket.close).toHaveBeenCalledOnce();
    expect(secondSocket.connect).toHaveBeenCalledWith("p1__worker", 0);
  });

  it("refetches windows on mount, so a stale session snapshot self-corrects (tabs missing after switching back)", async () => {
    const socket = fakeSocket();
    // The shell store's snapshot was fetched once at app load, before the
    // user opened the extra windows -- remounting SessionPane seeds from it.
    const staleSession = { ...SESSION, windows: 1, windowNames: ["main"] };
    const freshSession = { ...SESSION, windows: 3, windowNames: ["main", "logs", "test"] };
    const api = fakeApi({ listSessions: vi.fn().mockResolvedValue([freshSession]) });
    render(() => (
      <WebMainPane
        api={api as never}
        baseUrl="https://tmux.example.com"
        token="tok"
        project={PROJECT}
        session={staleSession}
        projectId="p1"
        onNewSession={vi.fn()}
        onSessionEnded={vi.fn()}
        pushStore={fakePushStore()}
        createSocket={() => socket as never}
        createTerminal={fakeTerminal}
        createFitAddon={fakeFitAddon}
        createSearchAddon={fakeSearchAddon}
      />
    ));

    expect(await screen.findByRole("tab", { name: "2: test" })).toBeInTheDocument();
    expect(api.listSessions).toHaveBeenCalledWith("p1");
  });
});
