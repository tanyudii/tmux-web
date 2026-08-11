// Small pill conveying connection/git/session state -- ports
// kmp/.../ui/components/TmuxStatusBadge.kt (itself a port of
// components/feedback/StatusBadge.jsx). Optional leading dot, optional
// pulse animation on the dot (reconnecting/live states) via the
// `tw-badge__dot--pulse` CSS animation in ui.css instead of a manually
// driven infinite transition.
import { Show } from "solid-js";

export type StatusTone =
  | "connected"
  | "disconnected"
  | "reconnecting"
  | "attached"
  | "idle"
  | "info"
  | "staged"
  | "unstaged"
  | "untracked"
  | "neutral";

export interface StatusBadgeProps {
  label: string;
  tone: StatusTone;
  dot?: boolean;
  mono?: boolean;
  pulse?: boolean;
  class?: string;
}

export function StatusBadge(props: StatusBadgeProps) {
  return (
    <span
      class={`tw-badge ${props.class ?? ""}`}
      classList={{ "tw-badge--mono": props.mono === true }}
      data-tone={props.tone}
    >
      <Show when={props.dot}>
        <span
          class="tw-badge__dot"
          classList={{ "tw-badge__dot--pulse": props.pulse === true }}
        />
      </Show>
      <span class="tw-badge__label">{props.label}</span>
    </span>
  );
}
