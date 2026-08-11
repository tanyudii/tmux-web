// Modal for destructive confirmation (delete project/session, discard a
// file's changes) -- ports kmp/.../ui/components/TmuxConfirmDialog.kt
// (itself a port of components/feedback/ConfirmDialog.jsx). `force`
// renders the escalated "active sessions will be killed" state used by
// the project/session force-delete retry flow.
import { Show, createSignal } from "solid-js";
import type { JSX } from "solid-js";
import { Button } from "./Button";

export interface ConfirmDialogProps {
  title: string;
  message: string;
  /**
   * Return the in-flight promise (do NOT `void` it) to get a spinner on the
   * confirm button for its duration. Every destructive action behind this
   * dialog is a real round trip -- killing tmux sessions, removing git
   * worktrees -- and without this the dialog sat there looking untouched until
   * it vanished, with nothing to say the click had registered.
   *
   * Keeping the pending state inside the dialog rather than asking each of its
   * ten call sites to thread an `isDeleting` flag down is what makes this
   * uniform: a call site opts in simply by not discarding its promise.
   */
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  force?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  children?: JSX.Element;
  class?: string;
}

function TrashIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M4 5.5h10M7.5 5.5V4a1 1 0 011-1h1a1 1 0 011 1v1.5M6 5.5v7.5a1 1 0 001 1h4a1 1 0 001-1V5.5"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M9 6.5v3.5M9 12.2h.01M8.1 2.9L1.9 13.6a1 1 0 00.87 1.5h12.46a1 1 0 00.87-1.5L9.9 2.9a1 1 0 00-1.74 0z"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

export function ConfirmDialog(props: ConfirmDialogProps) {
  const [isConfirming, setConfirming] = createSignal(false);

  function handleConfirm(): void {
    // Guard against a second click landing while the first is still running:
    // the confirm button is disabled during that window, but a double-click can
    // dispatch both events before the disabled attribute is applied, and these
    // actions are not idempotent (a second force-delete would target whatever
    // now occupies the name).
    if (isConfirming()) return;
    const result = props.onConfirm();
    // Only await a real promise. A call site that returns nothing keeps the
    // old fire-and-forget behaviour rather than getting a spinner that would
    // never resolve.
    if (!(result instanceof Promise)) return;
    setConfirming(true);
    // `finally` rather than `then`: on failure the dialog usually stays open to
    // show the error, and leaving it stuck in a permanent loading state would
    // make the retry unreachable.
    void result.finally(() => setConfirming(false));
  }

  return (
    <div
      class="tw-sheet-scrim"
      // Dismissing mid-flight would hide a destructive action the user can no
      // longer see the outcome of; the work does not stop just because the
      // dialog closed.
      onClick={() => {
        if (!isConfirming()) props.onCancel();
      }}
    >
      <div
        class={`tw-confirm-dialog ${props.class ?? ""}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div class="tw-confirm-dialog__header">
          <span
            class="tw-confirm-dialog__icon"
            classList={{ "tw-confirm-dialog__icon--force": props.force === true }}
          >
            <Show when={props.force} fallback={<TrashIcon />}>
              <AlertIcon />
            </Show>
          </span>
          <span class="tw-confirm-dialog__title">{props.title}</span>
        </div>
        <p class="tw-confirm-dialog__message">{props.message}</p>
        <Show when={props.force}>
          <div class="tw-confirm-dialog__force-warning">
            <AlertIcon />
            <span>Active sessions will be killed.</span>
          </div>
        </Show>
        {props.children}
        <div class="tw-confirm-dialog__footer">
          <Button
            label={props.cancelLabel ?? "Cancel"}
            variant="secondary"
            fillWidth
            disabled={isConfirming()}
            onClick={() => props.onCancel()}
          />
          <Button
            label={props.force ? "Force delete" : (props.confirmLabel ?? "Delete")}
            variant="danger"
            icon={<TrashIcon />}
            fillWidth
            loading={isConfirming()}
            onClick={handleConfirm}
          />
        </div>
      </div>
    </div>
  );
}
