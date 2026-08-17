import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { FitAddonLike, SearchAddonLike, TerminalLike } from "../terminal/types";
import { createPushStore, type PushStore } from "../stores/pushStore";
import { TerminalScreen } from "./TerminalScreen";

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

// Mobile copy/paste wiring. The selection itself is browser-native and can
// only be exercised for real in a browser (jsdom cannot run @xterm/xterm at
// all -- see terminal/TerminalView.tsx's header), so what is asserted here is
// the composition: which control reaches which handle method, and whether the
// terminal is hidden while the paste sheet is up.
describe("TerminalScreen mobile clipboard controls", () => {
  let pasteSpy: Mock<(data: string) => void>;

  beforeEach(() => {
    pasteSpy = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  function renderScreen() {
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
        createSocket={() => fakeSocket() as never}
        createTerminal={() => ({ ...fakeTerminal(), paste: pasteSpy })}
        createFitAddon={fakeFitAddon}
        createSearchAddon={fakeSearchAddon}
      />
    ));
  }

  function terminalContainer(): HTMLElement {
    return document.querySelector(".tw-terminal-screen__view > div") as HTMLElement;
  }

  it("swaps the control keys for the selection controls when Select is tapped", () => {
    renderScreen();

    fireEvent.click(screen.getByRole("button", { name: "Select" }));

    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "^C" })).toBeNull();
  });

  it("puts the terminal into selection mode so the browser can own the gesture", () => {
    renderScreen();

    fireEvent.click(screen.getByRole("button", { name: "Select" }));

    expect(terminalContainer().classList.contains("tw-terminal--selecting")).toBe(true);
  });

  it("leaves selection mode again on Done", () => {
    renderScreen();
    fireEvent.click(screen.getByRole("button", { name: "Select" }));

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(terminalContainer().classList.contains("tw-terminal--selecting")).toBe(false);
    expect(screen.getByRole("button", { name: "^C" })).toBeInTheDocument();
  });

  it("reports an empty copy rather than silently doing nothing", async () => {
    renderScreen();
    fireEvent.click(screen.getByRole("button", { name: "Select" }));

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    const toast = await waitFor(() => {
      const found = terminalContainer().querySelector(".tmux-copy-toast");
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(toast.textContent).toContain("Nothing selected");
  });

  it("opens the paste sheet from Paste", () => {
    renderScreen();

    fireEvent.click(screen.getByRole("button", { name: "Paste" }));

    expect(screen.getByLabelText("Text to paste")).toBeInTheDocument();
  });

  // Same rule CLAUDE.md flags for every other dialog on this screen: xterm's
  // own DOM sits on top and swallows clicks meant for whatever is shown over
  // it unless the container is explicitly hidden.
  it("hides the terminal while the paste sheet is open", () => {
    renderScreen();

    fireEvent.click(screen.getByRole("button", { name: "Paste" }));

    expect(terminalContainer().style.visibility).toBe("hidden");
  });

  it("sends the pasted text through xterm's paste path and closes the sheet", () => {
    renderScreen();
    fireEvent.click(screen.getByRole("button", { name: "Paste" }));
    const field = screen.getByLabelText("Text to paste");

    fireEvent.input(field, { target: { value: "npm run build" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(pasteSpy).toHaveBeenCalledExactlyOnceWith("npm run build");
    expect(screen.queryByLabelText("Text to paste")).toBeNull();
    expect(terminalContainer().style.visibility).toBe("visible");
  });
});

// Arrow pad wiring. What xterm emits for each key was measured in a real
// browser (see domain/virtualKeys.ts's header); jsdom cannot run xterm, so
// what is asserted here is the composition: which control reaches which
// handle method, and that the two bar modes never overlap.
describe("TerminalScreen arrow keys", () => {
  afterEach(() => {
    cleanup();
  });

  function renderScreen() {
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
        createSocket={() => fakeSocket() as never}
        createTerminal={fakeTerminal}
        createFitAddon={fakeFitAddon}
        createSearchAddon={fakeSearchAddon}
      />
    ));
  }

  it("swaps the control keys for the arrow pad when the toggle is tapped", () => {
    renderScreen();

    fireEvent.click(screen.getByRole("button", { name: "Arrow keys" }));

    expect(screen.getByRole("button", { name: "Up" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "^C" })).toBeNull();
  });

  it("routes an arrow tap all the way to a keydown on xterm's own input", () => {
    // The fake stands in for xterm closely enough to prove the routing: it
    // renders the same helper textarea the real library does, which is the
    // element pressVirtualKey targets. What xterm then EMITS for that event
    // is not knowable here (jsdom cannot run it) and was measured live
    // instead -- see domain/virtualKeys.ts's header.
    const events: KeyboardEvent[] = [];
    const terminalWithInput = () => {
      const fake = fakeTerminal();
      return {
        ...fake,
        open: (container: HTMLElement) => {
          const textarea = document.createElement("textarea");
          textarea.className = "xterm-helper-textarea";
          textarea.addEventListener("keydown", (event) => events.push(event));
          container.appendChild(textarea);
        },
      };
    };
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
        createSocket={() => fakeSocket() as never}
        createTerminal={terminalWithInput}
        createFitAddon={fakeFitAddon}
        createSearchAddon={fakeSearchAddon}
      />
    ));
    fireEvent.click(screen.getByRole("button", { name: "Arrow keys" }));

    fireEvent.click(screen.getByRole("button", { name: "Down" }));
    fireEvent.click(screen.getByRole("button", { name: "Shift Tab" }));

    expect(events.map((e) => [e.key, e.shiftKey])).toEqual([
      ["ArrowDown", false],
      ["Tab", true],
    ]);
  });

  it("leaves arrow mode on Done", () => {
    renderScreen();
    fireEvent.click(screen.getByRole("button", { name: "Arrow keys" }));

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(screen.getByRole("button", { name: "^C" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Up" })).toBeNull();
  });

  // The two modes fight over the same row and the same touch gesture, so
  // entering one must leave the other rather than stacking.
  it("entering selection mode leaves arrow mode", () => {
    renderScreen();
    fireEvent.click(screen.getByRole("button", { name: "Arrow keys" }));

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Select" }));

    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Up" })).toBeNull();
  });

  it("entering arrow mode leaves selection mode and drops the highlight", () => {
    renderScreen();
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    const container = document.querySelector(".tw-terminal-screen__view > div") as HTMLElement;
    expect(container.classList.contains("tw-terminal--selecting")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Arrow keys" }));

    expect(screen.getByRole("button", { name: "Up" })).toBeInTheDocument();
    expect(container.classList.contains("tw-terminal--selecting")).toBe(false);
  });
});

describe("TerminalScreen ctrl pad", () => {
  afterEach(() => {
    cleanup();
  });

  function renderScreen(createSocket: () => unknown = () => fakeSocket()) {
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
        createSocket={createSocket as never}
        createTerminal={fakeTerminal}
        createFitAddon={fakeFitAddon}
        createSearchAddon={fakeSearchAddon}
      />
    ));
  }

  it("swaps the control keys for the ctrl pad when the toggle is tapped", () => {
    renderScreen();

    fireEvent.click(screen.getByRole("button", { name: "Control keys" }));

    expect(screen.getByRole("button", { name: "^A" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "^Z" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Esc" })).toBeNull();
    // ^D moved here from the normal row when the ctrl pad took over its slot.
    expect(screen.getByRole("button", { name: "^D" })).toBeInTheDocument();
  });

  it("sends a ctrl key's raw byte down the same input path as typing", () => {
    const socket = fakeSocket();
    renderScreen(() => socket);
    fireEvent.click(screen.getByRole("button", { name: "Control keys" }));

    fireEvent.click(screen.getByRole("button", { name: "^A" }));

    expect(socket.sendInput).toHaveBeenCalledWith("\x01");
  });

  it("leaves ctrl mode on Done", () => {
    renderScreen();
    fireEvent.click(screen.getByRole("button", { name: "Control keys" }));

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(screen.getByRole("button", { name: "^C" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "^A" })).toBeNull();
  });

  // Same row, same rule as the arrows/selecting pair: entering one mode
  // must leave the others rather than stacking two rows.
  it("entering ctrl mode leaves arrow mode", () => {
    renderScreen();
    fireEvent.click(screen.getByRole("button", { name: "Arrow keys" }));

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Control keys" }));

    expect(screen.getByRole("button", { name: "^A" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Up" })).toBeNull();
  });

  it("entering arrow mode leaves ctrl mode", () => {
    renderScreen();
    fireEvent.click(screen.getByRole("button", { name: "Control keys" }));
    expect(screen.getByRole("button", { name: "^A" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Arrow keys" }));

    expect(screen.getByRole("button", { name: "Up" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "^A" })).toBeNull();
  });

  it("entering selection mode leaves ctrl mode", () => {
    renderScreen();
    fireEvent.click(screen.getByRole("button", { name: "Control keys" }));
    expect(screen.getByRole("button", { name: "^A" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Select" }));

    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "^A" })).toBeNull();
  });
});

// Regression guard for a test that used to pass for the wrong reason: the
// originals asserted only that the `tw-terminal--selecting` CSS class went
// away, which is driven by the isSelecting signal and happens whether or not
// clearSelection() is ever called. Mutation-checked: deleting the
// `terminalHandle()?.clearSelection()` call in TerminalScreen makes the test
// below fail, and left the old class-only assertions green.
describe("TerminalScreen leaving selection mode", () => {
  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    cleanup();
  });

  function renderWithSelectableTerminal() {
    const terminalWithText = () => ({
      ...fakeTerminal(),
      open: (container: HTMLElement) => {
        const row = document.createElement("div");
        row.textContent = "selected terminal text";
        container.appendChild(row);
      },
    });
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
        createSocket={() => fakeSocket() as never}
        createTerminal={terminalWithText}
        createFitAddon={fakeFitAddon}
        createSearchAddon={fakeSearchAddon}
      />
    ));
    return document.querySelector(".tw-terminal-screen__view > div") as HTMLElement;
  }

  function selectTerminalContents(container: HTMLElement): void {
    const range = document.createRange();
    range.selectNodeContents(container);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  it("Done drops the live DOM selection, not just the CSS class", () => {
    const container = renderWithSelectableTerminal();
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    selectTerminalContents(container);
    expect(window.getSelection()?.toString()).toContain("selected terminal text");

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(window.getSelection()?.toString()).toBe("");
  });

  it("switching to arrow mode drops the live DOM selection too", () => {
    const container = renderWithSelectableTerminal();
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    selectTerminalContents(container);

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Arrow keys" }));

    expect(window.getSelection()?.toString()).toBe("");
  });
});
