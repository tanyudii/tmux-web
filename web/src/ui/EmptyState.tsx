// Centered icon + title + subtitle placeholder for an empty list -- ports
// kmp/.../ui/components/TmuxEmptyState.kt.
import { Show } from "solid-js";
import type { JSX } from "solid-js";

export interface EmptyStateProps {
  icon?: JSX.Element;
  title: string;
  subtitle: string;
  class?: string;
}

export function EmptyState(props: EmptyStateProps) {
  return (
    <div class={`tw-empty-state ${props.class ?? ""}`}>
      <Show when={props.icon}>
        <div class="tw-empty-state__icon" aria-hidden="true">
          {props.icon}
        </div>
      </Show>
      <p class="tw-empty-state__title">{props.title}</p>
      <p class="tw-empty-state__subtitle">{props.subtitle}</p>
    </div>
  );
}
