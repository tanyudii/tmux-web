// Primary action control -- ports kmp/.../ui/components/TmuxButton.kt
// (itself a port of components/forms/Button.jsx). Icon props are plain
// Solid JSX slots rather than a fixed icon-name enum: this design system
// deliberately doesn't pick an icon set in Phase 5 (see the plan's Phase 5
// scope note) -- call sites in Phase 6/7 bring whatever SVG markup they
// need. Hover/press states are real CSS (:hover/:active in ui.css) instead
// of Compose's manually-tracked InteractionSource -- the DOM has native
// pseudo-classes for this, so there is nothing to port there.
import { Show } from "solid-js";
import type { JSX } from "solid-js";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "danger-ghost";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps {
  onClick?: () => void;
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: JSX.Element;
  trailingIcon?: JSX.Element;
  loading?: boolean;
  disabled?: boolean;
  fillWidth?: boolean;
  class?: string;
}

export function Button(props: ButtonProps) {
  const isDisabled = () => props.disabled === true || props.loading === true;

  return (
    <button
      type="button"
      class={`tw-button ${props.class ?? ""}`}
      classList={{ "tw-button--fill": props.fillWidth === true }}
      data-variant={props.variant ?? "primary"}
      data-size={props.size ?? "md"}
      disabled={isDisabled()}
      onClick={() => props.onClick?.()}
    >
      <Show when={props.loading} fallback={props.icon}>
        <span class="tw-button__spinner" aria-hidden="true" />
      </Show>
      <Show when={props.label}>
        <span class="tw-button__label">{props.label}</span>
      </Show>
      <Show when={!props.loading}>{props.trailingIcon}</Show>
    </button>
  );
}
