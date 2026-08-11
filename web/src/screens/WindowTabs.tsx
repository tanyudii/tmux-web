// Ports kmp/.../ui/web/WindowTabs.kt. Tabs represent tmux **windows within
// the single selected session** (not multiple open sessions). There is no
// per-window REST endpoint -- every action is a real tmux keystroke/
// command sent through the same PTY input path as typing:
//  - switch: raw `Ctrl-B <digit>` prefix keystroke
//  - new: raw `Ctrl-B c`, then a delayed refetch (tmux appends at the end)
//  - close/rename: a `:`-command-line sequence sent as three SEPARATE
//    timed writes (prefix+colon, command text, then \r) -- batching them
//    into one write breaks tmux's command-prompt Enter recognition
// `activeWindow` is owned by the caller (WebMainPane), not this
// component -- matches Kotlin's WebShellScreen owning it locally.
import { For, Show, createEffect, createSignal } from "solid-js";
import { ConfirmDialog, IconButton, Sheet, TextField } from "../ui";

const CTRL_B = "\x02";
const WINDOW_REFRESH_DELAY_MS = 400;
const TMUX_COMMAND_STEP_DELAY_MS = 80;

export interface WindowTabsProps {
  windowCount: number;
  activeWindow: number;
  serverWindowNames: string[];
  onSelectWindow: (index: number) => void;
  onWindowsChanged: () => void;
  onInput: (data: string) => void;
  onDialogOpenChanged?: (open: boolean) => void;
  wait?: (ms: number) => Promise<void>;
}

const realWait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function escapeForTmux(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function PlusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path d="M6.8 1.7a.85.85 0 011.2 1.2L3.5 7.4l-1.7.4.4-1.7 4.6-4.4z" stroke="currentColor" stroke-width="0.9" stroke-linejoin="round" />
    </svg>
  );
}

// How long to keep an optimistic tab on screen when the refetch never
// reports it. Only a backstop for a failed creation -- the success path
// clears it as soon as the real window count catches up, which is normally
// much sooner.
const OPTIMISTIC_TAB_TIMEOUT_MS = 5000;

export function WindowTabs(props: WindowTabsProps) {
  const wait = props.wait ?? realWait;
  const [localOverrides, setLocalOverrides] = createSignal<Record<number, string>>({});
  const [pendingClose, setPendingClose] = createSignal<number | null>(null);
  const [renaming, setRenaming] = createSignal<number | null>(null);
  // Index of a window that has been asked for but is not in the server's count
  // yet. Creating a window is a tmux KEYSTROKE (Ctrl-B c) with no response to
  // await, so the only way to learn it worked is the delayed refetch below.
  // Until that lands, `windowCount` is still the old value and the <For> below
  // renders no tab for the new window at all -- while onSelectWindow has
  // already made it active. The result was a tab strip with nothing selected
  // for ~400ms plus a round trip, which reads as the UI having gone blank.
  const [pendingWindow, setPendingWindow] = createSignal<number | null>(null);

  // Reset optimistic overrides whenever a fresh server snapshot lands --
  // ports Kotlin's `LaunchedEffect(serverWindowNames)`. Must be a real
  // Solid `createEffect` (tracks the reactive prop read inside it), not a
  // plain top-level `if` -- a component body runs once per mount, so a
  // bare `if` comparing values at setup time would never re-run when this
  // prop changes later (the exact bug class documented in
  // SessionListScreen.tsx's SessionRow).
  createEffect(() => {
    props.serverWindowNames;
    setLocalOverrides({});
  });

  // Clears the optimistic tab the moment the real one exists. Precise rather
  // than time-based, so the placeholder is replaced by the real tab exactly
  // when the server count catches up -- no arbitrary delay, no flicker of the
  // two coexisting. The timeout in newWindow() is only for the case where that
  // never happens.
  createEffect(() => {
    const pending = pendingWindow();
    if (pending !== null && props.windowCount > pending) setPendingWindow(null);
  });

  /** Tab count including an optimistic one, if a creation is still in flight. */
  const visibleWindowCount = (): number => {
    const pending = pendingWindow();
    return pending === null ? props.windowCount : Math.max(props.windowCount, pending + 1);
  };

  const isPendingIndex = (index: number): boolean => index >= props.windowCount;

  function nameFor(index: number): string {
    return localOverrides()[index] ?? props.serverWindowNames[index] ?? `${index}`;
  }

  function reportDialogOpen(open: boolean): void {
    props.onDialogOpenChanged?.(open);
  }

  function selectWindow(index: number): void {
    props.onInput(CTRL_B + String(index));
    props.onSelectWindow(index);
  }

  function newWindow(): void {
    const index = props.windowCount;
    setPendingWindow(index);
    props.onSelectWindow(index);
    props.onInput(CTRL_B + "c");
    void wait(WINDOW_REFRESH_DELAY_MS).then(() => {
      props.onWindowsChanged();
      // Backstop only. onWindowsChanged is fire-and-forget (returns void), so
      // there is nothing to await to learn whether the refetch found the new
      // window; without this a creation that silently failed would leave the
      // placeholder tab on screen forever. The success path does not wait for
      // this -- the createEffect above clears it as soon as the count grows.
      void wait(OPTIMISTIC_TAB_TIMEOUT_MS).then(() => {
        if (pendingWindow() === index) setPendingWindow(null);
      });
    });
  }

  async function sendTmuxCommand(command: string): Promise<void> {
    props.onInput(CTRL_B + ":");
    await wait(TMUX_COMMAND_STEP_DELAY_MS);
    props.onInput(command);
    await wait(TMUX_COMMAND_STEP_DELAY_MS);
    props.onInput("\r");
  }

  async function confirmClose(): Promise<void> {
    const index = pendingClose();
    if (index === null) return;
    // The dialog is dismissed at the END, not the start. Closing it first
    // unmounted it before ConfirmDialog could show its pending spinner, so the
    // confirm button never reported that anything was happening -- while this
    // function still has ~560ms of tmux command steps and a refetch delay left
    // to run. Verified live: sampling 120ms after the click found the dialog
    // already gone.
    await sendTmuxCommand(`kill-window -t ${index} ; move-window -r`);
    setLocalOverrides((current) => {
      const next = { ...current };
      delete next[index];
      return next;
    });
    props.onSelectWindow(0);
    await wait(WINDOW_REFRESH_DELAY_MS);
    props.onWindowsChanged();
    setPendingClose(null);
    reportDialogOpen(false);
  }

  async function confirmRename(index: number, name: string): Promise<void> {
    setRenaming(null);
    reportDialogOpen(false);
    setLocalOverrides((current) => ({ ...current, [index]: name }));
    await sendTmuxCommand(`rename-window -t ${index} "${escapeForTmux(name)}"`);
    await wait(WINDOW_REFRESH_DELAY_MS);
    props.onWindowsChanged();
  }

  return (
    <div class="tw-window-tabs" role="tablist">
      <For each={Array.from({ length: visibleWindowCount() }, (_, i) => i)}>
        {(index) => (
          <div
            class="tw-window-tab"
            classList={{
              "tw-window-tab--active": index === props.activeWindow,
              "tw-window-tab--pending": isPendingIndex(index),
            }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={index === props.activeWindow}
              // A tab for a window tmux has not confirmed yet cannot be
              // switched to -- `Ctrl-B <n>` would be a no-op at best.
              disabled={isPendingIndex(index)}
              aria-busy={isPendingIndex(index)}
              // The spinner is aria-hidden, so without this the button would
              // announce as just "2:" to a screen reader.
              aria-label={isPendingIndex(index) ? `Window ${index}, creating` : undefined}
              class="tw-window-tab__label"
              onClick={() => selectWindow(index)}
            >
              {index}:{" "}
              <Show when={isPendingIndex(index)} fallback={nameFor(index)}>
                <span class="tw-window-tab__spinner" aria-hidden="true" />
              </Show>
            </button>
            {/* Rename/close are withheld while pending: both address the window
                by index in a tmux command, and issuing one against a window
                that does not exist yet would hit whatever later occupies that
                index. */}
            <Show when={!isPendingIndex(index)}>
              <span class="tw-window-tab__actions">
                <IconButton
                  icon={<PencilIcon />}
                  label={`Rename window ${index}`}
                  size="sm"
                  onClick={() => {
                    setRenaming(index);
                    reportDialogOpen(true);
                  }}
                />
                <IconButton
                  icon={<CloseIcon />}
                  label={`Close window ${index}`}
                  size="sm"
                  onClick={() => {
                    setPendingClose(index);
                    reportDialogOpen(true);
                  }}
                />
              </span>
            </Show>
          </div>
        )}
      </For>
      <IconButton icon={<PlusIcon />} label="New window" size="sm" onClick={newWindow} />

      <Show when={pendingClose() !== null}>
        <ConfirmDialog
          title="Close window"
          message={`Close window ${pendingClose()}: ${nameFor(pendingClose() ?? 0)}?`}
          confirmLabel="Close"
          onConfirm={() => confirmClose()}
          onCancel={() => {
            setPendingClose(null);
            reportDialogOpen(false);
          }}
        />
      </Show>

      <Show when={renaming() !== null}>
        {(() => {
          const [name, setName] = createSignal(nameFor(renaming() ?? 0));
          return (
            <Sheet
              title="Rename Window"
              actionLabel="Save"
              actionEnabled={name().trim() !== ""}
              onDismiss={() => {
                setRenaming(null);
                reportDialogOpen(false);
              }}
              onAction={() => void confirmRename(renaming() as number, name().trim())}
            >
              <TextField label="Name" value={name()} onValueChange={setName} />
            </Sheet>
          );
        })()}
      </Show>
    </div>
  );
}
