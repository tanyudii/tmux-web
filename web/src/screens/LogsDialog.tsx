// Ports kmp/.../ui/components/TmuxLogsDialog.kt -- live docker-compose
// service logs popup, opened from the Environment menu's per-service logs
// icon (task #18e's "ServiceRow"). Lets the user switch which service's
// logs stream without closing the popup, and auto-scrolls to new output
// only while already near the bottom. Built and tested standalone here
// since #18e (the trigger) doesn't exist yet -- `services` defaults to an
// empty list until then; see task #18e's description for the required
// live-verification follow-up.
import { createEffect, createSignal, For, Show, onCleanup, onMount } from "solid-js";
import { IconButton, StatusBadge } from "../ui";
import type { LogsStore } from "../stores/logsStore";
import type { EnvStatus } from "../api/types";

type ComposeServiceStatus = NonNullable<EnvStatus["services"]>[number];

export interface LogsDialogProps {
  selectedService: string;
  services: ComposeServiceStatus[];
  store: LogsStore;
  onDismiss: () => void;
  onSwitchService: (service: string) => void;
}

// Within this many items of the end still counts as "at the bottom" --
// matches TmuxLogsDialog.kt's BOTTOM_PROXIMITY_ITEMS.
const BOTTOM_PROXIMITY_PX = 48;

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

function serviceDotTone(state: string): "connected" | "reconnecting" | "disconnected" | "idle" {
  switch (state.toLowerCase()) {
    case "running":
      return "connected";
    case "starting":
      return "reconnecting";
    case "error":
      return "disconnected";
    default:
      return "idle";
  }
}

export function LogsDialog(props: LogsDialogProps) {
  const [switcherOpen, setSwitcherOpen] = createSignal(false);
  const [isNearBottom, setNearBottom] = createSignal(true);
  let listEl: HTMLDivElement | undefined;

  onMount(() => props.store.start(props.selectedService));
  onCleanup(() => props.store.close());

  function checkNearBottom(): void {
    if (!listEl) return;
    const distance = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight;
    setNearBottom(distance <= BOTTOM_PROXIMITY_PX);
  }

  function scrollToBottom(): void {
    if (!listEl) return;
    listEl.scrollTop = listEl.scrollHeight;
    setNearBottom(true);
  }

  // Auto-scrolls only while already near the bottom -- a user who scrolled
  // up to read earlier output must not get yanked back down by new lines.
  let previousLineCount = 0;
  createEffect(() => {
    const count = props.store.state.lines.length;
    if (count > previousLineCount && isNearBottom()) {
      queueMicrotask(scrollToBottom);
    }
    previousLineCount = count;
  });

  return (
    <div class="tw-sheet-scrim" onClick={() => props.onDismiss()}>
      <div class="tw-logs-dialog" onClick={(event) => event.stopPropagation()}>
        <div class="tw-logs-dialog__header">
          <IconButton icon={<CloseIcon />} label="Close logs" size="sm" onClick={() => props.onDismiss()} />
          <div class="tw-logs-dialog__switcher">
            <button
              type="button"
              class="tw-logs-dialog__switcher-trigger"
              onClick={() => setSwitcherOpen((open) => !open)}
            >
              <span>Logs: {props.selectedService}</span>
              <ChevronDownIcon />
            </button>
            <Show when={switcherOpen()}>
              <div class="tw-logs-dialog__switcher-menu">
                <For each={props.services}>
                  {(service) => (
                    <button
                      type="button"
                      class="tw-logs-dialog__switcher-item"
                      onClick={() => {
                        setSwitcherOpen(false);
                        props.onSwitchService(service.service);
                        void props.store.switchService(service.service);
                      }}
                    >
                      <span class="tw-logs-dialog__switcher-dot" data-tone={serviceDotTone(service.state)} />
                      {service.service}
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>
          <StatusBadge
            label={props.store.state.isConnected ? "live" : "disconnected"}
            tone={props.store.state.isConnected ? "connected" : "disconnected"}
            dot
            pulse={props.store.state.isConnected}
          />
        </div>

        <div class="tw-logs-dialog__body">
          <div class="tw-logs-dialog__list" ref={listEl} onScroll={checkNearBottom}>
            <For each={props.store.state.lines}>{(line) => <div class="tw-logs-dialog__line">{line}</div>}</For>
          </div>
          <Show when={!isNearBottom() && props.store.state.lines.length > 0}>
            <IconButton
              icon={<ChevronDownIcon />}
              label="Jump to latest"
              variant="filled"
              class="tw-logs-dialog__jump"
              onClick={scrollToBottom}
            />
          </Show>
        </div>
      </div>
    </div>
  );
}
