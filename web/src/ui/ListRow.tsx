// Tappable row for project/session lists -- ports kmp/.../ui/components/
// TmuxListRow.kt (itself a port of components/data/ListRow.jsx). Leading
// icon badge, sans title, mono subtitle, sans meta line, and an optional
// `trailing` slot rendered before the auto-chevron (additive, not instead
// of it).
//
// Renders as `<div role="button">` (not a real `<button>`) whenever
// `onClick` is given, with manual Enter/Space activation to keep it
// keyboard-operable. A real nested `<button>` was tried first and passed
// every jsdom unit test, but broke live in a real browser: HTML forbids
// interactive content (another `<button>`, as `trailing` legitimately
// needs for a favorite/edit/delete action) inside a `<button>`, so the
// browser's parser silently reparents the nested button as a *sibling*
// once it hits one, splitting the row and breaking the intended click
// target -- exactly the class of bug jsdom's parser doesn't enforce the
// same way a real browser does (see CLAUDE.md's mandatory live-UI-
// verification rule; caught only by driving this live, not by any test
// or typecheck run).
import { Show } from "solid-js";
import type { JSX } from "solid-js";

export interface ListRowProps {
  title: string;
  subtitle?: string;
  meta?: string;
  icon?: JSX.Element;
  leading?: JSX.Element;
  trailing?: JSX.Element;
  chevron?: boolean;
  active?: boolean;
  onClick?: () => void;
  class?: string;
}

function ChevronIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M7 4l5 5-5 5"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

export function ListRow(props: ListRowProps) {
  const showChevron = () => props.chevron !== false && Boolean(props.onClick);

  function handleKeyDown(event: KeyboardEvent): void {
    if (!props.onClick) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      props.onClick();
    }
  }

  return (
    <div
      class={`tw-list-row ${props.class ?? ""}`}
      classList={{ "tw-list-row--interactive": Boolean(props.onClick) }}
      data-active={props.active === true ? "true" : undefined}
      role={props.onClick ? "button" : undefined}
      tabIndex={props.onClick ? 0 : undefined}
      onClick={props.onClick ? () => props.onClick?.() : undefined}
      onKeyDown={props.onClick ? handleKeyDown : undefined}
    >
      <Show when={props.leading}>
        <span class="tw-list-row__slot">{props.leading}</span>
      </Show>
      <Show when={props.icon}>
        <span class="tw-list-row__icon" aria-hidden="true">
          {props.icon}
        </span>
      </Show>
      <span class="tw-list-row__texts">
        <span class="tw-list-row__title">{props.title}</span>
        <Show when={props.subtitle}>
          <span class="tw-list-row__subtitle">{props.subtitle}</span>
        </Show>
        <Show when={props.meta}>
          <span class="tw-list-row__meta">{props.meta}</span>
        </Show>
      </span>
      {/* Wrapped in a `flex-shrink: 0` slot rather than dropped in raw: an
          unwrapped element is a plain flex child with the default
          `flex-shrink: 1`, so a long title/subtitle squeezed it until the
          action icon inside was visibly clipped. */}
      <Show when={props.trailing}>
        <span class="tw-list-row__slot">{props.trailing}</span>
      </Show>
      <Show when={showChevron()}>
        <span class="tw-list-row__chevron">
          <ChevronIcon />
        </span>
      </Show>
    </div>
  );
}
