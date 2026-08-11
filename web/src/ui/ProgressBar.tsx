// Determinate or indeterminate progress track -- ports kmp/.../ui/
// components/TmuxProgressBar.kt (itself a port of
// components/feedback/ProgressBar.jsx). `value` undefined renders the
// sweeping indeterminate bar used while a new tmux session is being
// created. The indeterminate sweep is a CSS `animation` (ui.css's
// `tw-sweep` keyframe) instead of a manually driven infinite transition.
import { Show } from "solid-js";

const PROGRESS_MAX_PERCENT = 100;

export interface ProgressBarProps {
  value?: number;
  label?: string;
  class?: string;
}

function clampPercent(value: number): number {
  return Math.min(PROGRESS_MAX_PERCENT, Math.max(0, value));
}

export function ProgressBar(props: ProgressBarProps) {
  return (
    <div class={`tw-progress ${props.class ?? ""}`}>
      <Show when={props.label}>
        <div class="tw-progress__label-row">
          <span class="tw-progress__label">{props.label}</span>
          <Show when={props.value !== undefined}>
            <span class="tw-progress__percent">
              {Math.round(clampPercent(props.value ?? 0))}%
            </span>
          </Show>
        </div>
      </Show>
      <div class="tw-progress__track">
        <Show
          when={props.value !== undefined}
          fallback={<div class="tw-progress__sweep" />}
        >
          <div
            class="tw-progress__fill"
            style={{ width: `${clampPercent(props.value ?? 0)}%` }}
          />
        </Show>
      </div>
    </div>
  );
}
