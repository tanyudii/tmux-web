// Ports the inline AccessLogDialog composable in kmp/.../WebShellScreen.kt
// (EMB-223) -- read-only, reachable from the Web sidebar's footer.
import { For, Show, onMount } from "solid-js";
import { Button, ProgressBar } from "../ui";
import type { AccessLogStore } from "../stores/accessLogStore";

export interface AccessLogDialogProps {
  store: AccessLogStore;
  onDismiss: () => void;
}

export function AccessLogDialog(props: AccessLogDialogProps) {
  onMount(() => void props.store.refresh());

  const state = () => props.store.state;

  return (
    <div class="tw-sheet-scrim" onClick={() => props.onDismiss()}>
      <div class="tw-simple-log-dialog" onClick={(event) => event.stopPropagation()}>
        <span class="tw-simple-log-dialog__title">Access log</span>
        <p class="tw-simple-log-dialog__hint">
          Requests authenticated with this server's shared token -- identifies activity per IP, not per person.
        </p>

        <Show when={state().isLoading}>
          <ProgressBar label="Loading…" />
        </Show>
        <Show when={state().errorMessage}>
          <p class="tw-simple-log-dialog__error">{state().errorMessage}</p>
        </Show>
        <Show when={!state().isLoading && !state().errorMessage && state().entries.length === 0}>
          <p class="tw-simple-log-dialog__empty">No access recorded yet.</p>
        </Show>
        <Show when={!state().isLoading && !state().errorMessage && state().entries.length > 0}>
          <div class="tw-simple-log-dialog__list">
            <For each={state().entries}>
              {(entry) => (
                <div class="tw-simple-log-dialog__row">
                  <div class="tw-simple-log-dialog__row-top">
                    <span class="tw-simple-log-dialog__timestamp">{entry.timestamp}</span>
                    <span
                      class="tw-simple-log-dialog__outcome"
                      classList={{ "tw-simple-log-dialog__outcome--denied": entry.outcome !== "authorized" }}
                    >
                      {entry.outcome}
                    </span>
                  </div>
                  <span class="tw-simple-log-dialog__detail">
                    {entry.method} {entry.path} · {entry.ip}
                  </span>
                </div>
              )}
            </For>
          </div>
        </Show>

        <div class="tw-simple-log-dialog__footer">
          <Button label="Refresh" variant="ghost" fillWidth onClick={() => void props.store.refresh()} />
          <Button label="Close" variant="primary" fillWidth onClick={() => props.onDismiss()} />
        </div>
      </div>
    </div>
  );
}
