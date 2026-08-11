// Ports kmp/.../ui/components/TmuxEnvironmentMenu.kt -- one toolbar
// control: click to run the session's docker-compose environment, shows a
// "Setting up…" state, then becomes a dropdown of services once running.
// Renders nothing when `status` is null/unavailable (projects without
// `.tmux-web-env/` never show this control). `onOpenChanged` fires whenever
// the dropdown's open/closed state changes -- hosts use it to keep the
// terminal's xterm.js DOM element out of the way for its duration, the same
// click-swallowing concern TerminalView.tsx's `isVisible` prop already
// exists for (see CLAUDE.md's flagged Popup-vs-native-DOM bug class).
import { createEffect, createSignal, Index, onCleanup, Show } from "solid-js";
import { IconButton } from "../ui";
import type { EnvStatus } from "../api/types";

type ComposeServiceStatus = NonNullable<EnvStatus["services"]>[number];
type EnvOpenLink = NonNullable<EnvStatus["openLinks"]>[number];

export interface EnvironmentMenuProps {
  status: EnvStatus | null;
  isBusy: boolean;
  onRun: () => void;
  onStop: () => void;
  onCancel: () => void;
  onEditConfig: () => void;
  onViewLogs: (service: string) => void;
  onOpenChanged?: (open: boolean) => void;
}

function BoxIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.5 5l5.5-3 5.5 3-5.5 3-5.5-3zm0 0v6l5.5 3m0-9v9m0-9l5.5 3v6l-5.5 3"
        stroke="currentColor"
        stroke-width="1.2"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2.5 4.5l3.5 3 3.5-3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
    </svg>
  );
}

function LogsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="2" y="2.5" width="10" height="9" rx="1.2" stroke="currentColor" stroke-width="1.2" />
      <path d="M4.3 5.2h5.4M4.3 7.5h5.4M4.3 9.2h3" stroke="currentColor" stroke-width="1" stroke-linecap="round" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M5.5 2.5H3a1 1 0 00-1 1V11a1 1 0 001 1h7.5a1 1 0 001-1V8.5M8 2.5h3.5V6M11.3 2.7L6.5 7.5"
        stroke="currentColor"
        stroke-width="1.2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <rect x="2.5" y="2.5" width="8" height="8" rx="1" stroke="currentColor" stroke-width="1.2" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M9.3 2.3a1 1 0 011.4 0l1 1a1 1 0 010 1.4L5 11.4l-2.7.7.7-2.7 6.3-7.1zM8 3.6l2.4 2.4"
        stroke="currentColor"
        stroke-width="1.2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function dotTone(state: string): string {
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

function openInNewTab(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

function ServiceRow(props: { service: ComposeServiceStatus; openLink?: EnvOpenLink; onOpen: () => void; onViewLogs: () => void }) {
  return (
    <div class="tw-env-menu__service-row">
      <span class="tw-env-menu__dot" data-tone={dotTone(props.service.state)} />
      <button
        type="button"
        class="tw-env-menu__service-name"
        disabled={props.openLink === undefined}
        onClick={props.onOpen}
      >
        {props.service.service}
      </button>
      <IconButton icon={<LogsIcon />} label={`View ${props.service.service} logs`} size="sm" onClick={props.onViewLogs} />
      <Show when={props.openLink} fallback={<span class="tw-env-menu__service-state">{props.service.state}</span>}>
        <button type="button" class="tw-env-menu__open-link" aria-label={`Open ${props.service.service} in a new tab`} onClick={props.onOpen}>
          <ExternalLinkIcon />
        </button>
      </Show>
    </div>
  );
}

export function EnvironmentMenu(props: EnvironmentMenuProps) {
  const [open, setOpen] = createSignal(false);
  let containerEl: HTMLDivElement | undefined;

  createEffect(() => props.onOpenChanged?.(open()));

  function handlePointerDown(event: PointerEvent): void {
    if (containerEl && event.target instanceof Node && !containerEl.contains(event.target)) setOpen(false);
  }
  window.addEventListener("pointerdown", handlePointerDown);
  onCleanup(() => window.removeEventListener("pointerdown", handlePointerDown));

  const running = () => props.status?.phase === "running";
  const starting = () => props.status?.phase === "starting" || (props.isBusy && props.status?.phase === "idle");
  // Only wire the visible cancel affordance once the server has actually
  // registered a "starting" transient -- the synchronous isBusy-before-poll-
  // catches-up window is too short to realistically click Cancel in, and
  // calling cancelEnv() before the server-side entry exists just surfaces a
  // confusing error.
  const canCancel = () => props.status?.phase === "starting";
  const services = () => props.status?.services ?? [];
  const upCount = () => services().filter((s) => s.state.toLowerCase() === "running").length;
  const linksByService = () => new Map((props.status?.openLinks ?? []).map((link) => [link.service, link] as const));
  const unmatchedLinks = () => (props.status?.openLinks ?? []).filter((link) => !services().some((s) => s.service === link.service));
  // Idle/starting states show only an icon (no visible text) -- an
  // icon-only control needs an accessible name regardless, per the
  // accessibility rule for icon-only buttons.
  const toggleLabel = () => {
    if (running()) return "Environment services";
    if (starting()) return "Setting up environment";
    return "Run environment";
  };

  return (
    <Show when={props.status !== null && props.status.phase !== "unavailable"}>
      <div class="tw-env-menu" ref={containerEl}>
        <div class="tw-env-menu__row">
          <button
            type="button"
            class="tw-env-menu__toggle"
            classList={{ "tw-env-menu__toggle--running": running() }}
            disabled={starting()}
            aria-label={toggleLabel()}
            onClick={() => (running() ? setOpen((v) => !v) : props.onRun())}
          >
            <Show when={starting()} fallback={<BoxIcon />}>
              <span class="tw-env-menu__spinner" aria-hidden="true" />
            </Show>
            <Show when={starting()}>
              <span class="tw-env-menu__label">Setting up…</span>
            </Show>
            <Show when={running()}>
              <span class="tw-env-menu__count">
                {upCount()}/{services().length}
              </span>
              <ChevronDownIcon />
            </Show>
          </button>
          <Show when={starting() && canCancel()}>
            <IconButton icon={<CloseIcon />} label="Cancel environment setup" size="sm" onClick={props.onCancel} />
          </Show>
          <IconButton icon={<EditIcon />} label="Edit environment config" size="sm" onClick={props.onEditConfig} />
        </div>
        <Show when={open() && running()}>
          <div class="tw-env-menu__dropdown">
            <div class="tw-env-menu__dropdown-header">
              <span class="tw-env-menu__dot" data-tone="connected" />
              <span>Server running</span>
            </div>
            {/* Index, not For: the environment poll (every 3s, environmentStore.ts)
                replaces `status` with a brand-new parsed object each tick (the API
                client's Zod .parse() never returns the same reference), so a plain
                For (which reconciles by item identity) would tear down and rebuild
                every row every 3 seconds even when nothing actually changed --
                Index reconciles by position instead, updating the existing DOM
                in place. Confirmed via live verification: this churn was flaky
                enough to occasionally drop a click on "View logs" mid-poll. */}
            <Index each={services()}>
              {(service) => (
                <ServiceRow
                  service={service()}
                  openLink={linksByService().get(service().service)}
                  onOpen={() => {
                    const link = linksByService().get(service().service);
                    if (link) {
                      openInNewTab(link.url);
                      setOpen(false);
                    }
                  }}
                  onViewLogs={() => {
                    setOpen(false);
                    props.onViewLogs(service().service);
                  }}
                />
              )}
            </Index>
            <Index each={unmatchedLinks()}>
              {(link) => (
                <button
                  type="button"
                  class="tw-env-menu__open-link-row"
                  onClick={() => {
                    openInNewTab(link().url);
                    setOpen(false);
                  }}
                >
                  <ExternalLinkIcon />
                  <span>{link().label}</span>
                </button>
              )}
            </Index>
            <button
              type="button"
              class="tw-env-menu__stop"
              onClick={() => {
                setOpen(false);
                props.onStop();
              }}
            >
              <StopIcon />
              <span>Stop environment</span>
            </button>
          </div>
        </Show>
      </div>
    </Show>
  );
}
