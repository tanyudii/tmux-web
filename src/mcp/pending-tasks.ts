// Tracks, per tmux session, whether an MCP send_message call is currently
// waiting on that session's `claude` REPL to finish a turn (Stop/Notification
// hook). Deliberately in-memory only: the wait itself is a live Promise held
// by the `tmuxweb mcp` process handling the tool call, so there is nothing
// meaningful to persist across a process restart -- a restart drops any
// in-flight wait, and the caller sees a fresh "not busy" session next time.

export type SessionTaskStatus = "idle" | "busy";

export interface HookEvent {
  hookEvent: "Stop" | "Notification";
  text: string;
}

export class SessionBusyError extends Error {}
export class TaskTimeoutError extends Error {}

interface PendingEntry {
  status: SessionTaskStatus;
  resolve?: (event: HookEvent) => void;
  reject?: (error: Error) => void;
}

export type PendingTaskStore = Map<string, PendingEntry>;

export function createPendingTaskStore(): PendingTaskStore {
  return new Map();
}

export function getSessionStatus(store: PendingTaskStore, sessionName: string): SessionTaskStatus {
  return store.get(sessionName)?.status ?? "idle";
}

// Claims the session as busy AND registers the hook-event waiter in the same
// synchronous call -- no await happens between the two. Splitting these into
// separate calls (as an earlier version of this module did) left a real gap:
// a hook-script POST arriving after the busy-claim but before the resolver
// was registered would find no `resolve` to call and be silently dropped,
// stranding the caller until its own timeout for no reason. The returned
// promise resolves via resolveHookEvent, or rejects with TaskTimeoutError
// after timeoutMs -- either way the session is returned to "idle".
export function beginWait(store: PendingTaskStore, sessionName: string, timeoutMs: number): Promise<HookEvent> {
  if (getSessionStatus(store, sessionName) === "busy") {
    throw new SessionBusyError(`Session "${sessionName}" is already busy`);
  }

  return new Promise<HookEvent>((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      store.set(sessionName, { status: "idle" });
      reject(new TaskTimeoutError(`Timed out after ${timeoutMs}ms waiting for a Stop/Notification hook from "${sessionName}"`));
    }, timeoutMs);

    store.set(sessionName, {
      status: "busy",
      resolve: (event) => {
        clearTimeout(timeoutHandle);
        store.set(sessionName, { status: "idle" });
        resolve(event);
      },
      reject: (error) => {
        clearTimeout(timeoutHandle);
        store.set(sessionName, { status: "idle" });
        reject(error);
      },
    });
  });
}

// Called by the hook listener when a Stop/Notification POST arrives. Returns
// false (and delivers nothing) if no one is currently waiting on this
// session -- covers both "never started" and "a previous wait already timed
// out or failed" (the entry's `resolve` is cleared/replaced in both cases).
export function resolveHookEvent(store: PendingTaskStore, sessionName: string, event: HookEvent): boolean {
  const entry = store.get(sessionName);
  if (!entry?.resolve) return false;
  entry.resolve(event);
  return true;
}

// Escape hatch for a caller that called beginWait but hit a setup error
// (e.g. sendKeys failing right after session creation) before any hook
// event could plausibly arrive. Rejects the still-pending wait promise
// (clearing its timeout, so no leaked timer keeps the process alive) rather
// than leaving it to reject on its own many minutes later via timeout, and
// returns the session to idle either way -- including when there is no
// pending wait to fail (defensive; should not normally happen).
export function failWait(store: PendingTaskStore, sessionName: string, error: Error): void {
  const entry = store.get(sessionName);
  if (entry?.reject) {
    entry.reject(error);
  } else {
    store.set(sessionName, { status: "idle" });
  }
}
