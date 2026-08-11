// Full-width status strip pinned above the terminal when the socket drops
// -- ports kmp/.../ui/components/TmuxConnectionBanner.kt (itself a port of
// components/feedback/ConnectionBanner.jsx). Callers add the bottom
// hairline divider themselves, same as the Kotlin original -- it belongs
// to the surrounding layout, not this component's own bounds.
//
// Unlike the rest of this design-system pass (which deliberately leaves
// icon choice to call sites, see Button.tsx), this component hardcodes
// three tiny inline SVGs: connection status is exactly the one place
// where the icon *is* the semantic content (disconnected/reconnecting/
// connected), not decoration, so it can't be deferred to a slot the way a
// generic button icon can.
import { Show } from "solid-js";

// "ended" means the tmux session itself is gone (its last window was closed),
// which is not recoverable by retrying -- so it gets its own status with an
// action that navigates away instead of a Retry that could only ever fail.
export type ConnectionStatus = "disconnected" | "reconnecting" | "connected" | "ended";

export interface ConnectionBannerProps {
  status: ConnectionStatus;
  message?: string;
  onRetry?: () => void;
  /** Shown instead of Retry for the "ended" status. */
  onLeave?: () => void;
  leaveLabel?: string;
  class?: string;
}

const DEFAULT_LABEL: Record<ConnectionStatus, string> = {
  disconnected: "Disconnected",
  reconnecting: "Reconnecting…",
  connected: "Connected",
  ended: "Session ended — its last window was closed.",
};

function WifiOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M1 1l14 14M3.5 6.5a9 9 0 0 1 9-2M1.5 9a11 11 0 0 1 3-2.3M8 12.5h.01M5.8 10.3a5 5 0 0 1 4.4-.9"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M13.5 8a5.5 5.5 0 1 1-1.7-4"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
      />
      <path d="M13.5 2.5V6H10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 8.5l3.2 3.2L13 4.5"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function iconFor(status: ConnectionStatus) {
  switch (status) {
    case "disconnected":
      return <WifiOffIcon />;
    case "reconnecting":
      return <RefreshIcon />;
    case "connected":
      return <CheckIcon />;
    case "ended":
      return <WifiOffIcon />;
  }
}

export function ConnectionBanner(props: ConnectionBannerProps) {
  return (
    <div
      class={`tw-banner tw-connection-banner ${props.class ?? ""}`}
      data-status={props.status}
      role="status"
    >
      <span
        class="tw-connection-banner__icon"
        classList={{ "tw-connection-banner__icon--spin": props.status === "reconnecting" }}
      >
        {iconFor(props.status)}
      </span>
      <span class="tw-banner__message">{props.message ?? DEFAULT_LABEL[props.status]}</span>
      <Show when={props.status === "ended" && props.onLeave}>
        <button type="button" class="tw-connection-banner__retry" onClick={() => props.onLeave?.()}>
          {props.leaveLabel ?? "Back"}
        </button>
      </Show>
      <Show when={props.status !== "ended" && props.onRetry}>
        <button type="button" class="tw-connection-banner__retry" onClick={() => props.onRetry?.()}>
          Retry
        </button>
      </Show>
    </div>
  );
}
