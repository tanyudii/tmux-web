// Square, icon-only control (toolbar, nav bar, row actions) -- ports
// kmp/.../ui/components/TmuxIconButton.kt. `label` is required (not
// optional) because an icon-only control has no visible text for a screen
// reader to announce otherwise; it becomes the button's aria-label.
import type { JSX } from "solid-js";

export type IconButtonVariant = "ghost" | "filled" | "danger";
export type IconButtonSize = "sm" | "md" | "lg";

export interface IconButtonProps {
  icon: JSX.Element;
  label: string;
  onClick?: () => void;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  disabled?: boolean;
  class?: string;
}

export function IconButton(props: IconButtonProps) {
  return (
    <button
      type="button"
      class={`tw-icon-button ${props.class ?? ""}`}
      data-variant={props.variant ?? "ghost"}
      data-size={props.size ?? "md"}
      aria-label={props.label}
      disabled={props.disabled === true}
      onClick={() => props.onClick?.()}
    >
      {props.icon}
    </button>
  );
}
