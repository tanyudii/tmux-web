// iOS bottom form sheet -- ports kmp/.../ui/components/TmuxSheet.kt (itself
// a port of ui_kits/ios/chrome.jsx's `Sheet`). Scrim + slide-up panel with
// a Cancel/title/Action header row (New Project / New Session / Session
// label forms). Callers mount this conditionally (`<Show when={state()}>`)
// same as the Kotlin original -- there's no exit animation here either.
import type { JSX } from "solid-js";

export interface SheetProps {
  title: string;
  actionLabel: string;
  onDismiss: () => void;
  onAction: () => void;
  actionEnabled?: boolean;
  children: JSX.Element;
  class?: string;
}

export function Sheet(props: SheetProps) {
  const actionEnabled = () => props.actionEnabled !== false;

  return (
    <div class="tw-sheet-scrim" onClick={() => props.onDismiss()}>
      <div class={`tw-sheet ${props.class ?? ""}`} onClick={(event) => event.stopPropagation()}>
        <div class="tw-sheet__header">
          <button type="button" class="tw-sheet__cancel" onClick={() => props.onDismiss()}>
            Cancel
          </button>
          <span class="tw-sheet__title">{props.title}</span>
          <button
            type="button"
            class="tw-sheet__action"
            disabled={!actionEnabled()}
            onClick={() => props.onAction()}
          >
            {props.actionLabel}
          </button>
        </div>
        <div class="tw-sheet__content">{props.children}</div>
      </div>
    </div>
  );
}
