// HIG-style nav bar -- ports kmp/.../ui/components/TmuxNavBar.kt (itself a
// port of ui_kits/ios/chrome.jsx's `NavBar`). `large` renders the title
// below the bar as a big bold headline (screen content scrolls underneath
// it); non-large renders it centered inline in the bar. Added to the
// design system kit here in Phase 6 (not Phase 5) because it's the first
// screen-composition primitive actually needed by a real screen --
// Phase 5 deliberately scoped to primitives with no screen to consume yet.
//
// The Kotlin original approximates a translucent blur-behind-content bar
// with a plain alpha-tinted background because Compose Multiplatform has
// no cross-target blur-behind primitive. The DOM has one
// (`backdrop-filter`), so this uses the real thing instead -- a genuine
// improvement, not a fidelity gap, ported back is intentional divergence.
import { Show } from "solid-js";
import type { JSX } from "solid-js";

export interface NavBarBack {
  label: string;
  onClick: () => void;
}

export interface NavBarProps {
  title: string;
  large?: boolean;
  back?: NavBarBack;
  leading?: JSX.Element;
  right?: JSX.Element;
  class?: string;
}

function ChevronLeftIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <path
        d="M13 5l-6 6 6 6"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

export function NavBar(props: NavBarProps) {
  // In large mode the actions sit ON the headline row rather than in the
  // compact bar above it. Previously they stayed up in the bar while the title
  // dropped below it, so on the project list the "+" was a whole row apart from
  // the "Projects" heading it belongs to -- two half-empty rows doing the work
  // of one.
  const actionsOnHeadline = () => props.large === true;
  // With the actions moved down, the compact bar has nothing left to render in
  // large mode; keeping it would leave an empty 44px strip pushing the whole
  // screen down. It is still needed when there is a back button to host, since
  // a back affordance belongs above the title, not beside it.
  const showBar = () => !props.large || props.back !== undefined;

  return (
    <div class={`tw-navbar ${props.class ?? ""}`}>
      <Show when={showBar()}>
        <div class="tw-navbar__bar">
          <div class="tw-navbar__rail tw-navbar__rail--start">
            <Show when={props.back} fallback={actionsOnHeadline() ? undefined : props.leading}>
              {(back) => (
                <button type="button" class="tw-navbar__back" onClick={() => back().onClick()}>
                  <ChevronLeftIcon />
                  <span>{back().label}</span>
                </button>
              )}
            </Show>
          </div>
          <Show when={!props.large}>
            <span class="tw-navbar__title">{props.title}</span>
          </Show>
          <div class="tw-navbar__rail tw-navbar__rail--end">
            <Show when={!actionsOnHeadline()}>{props.right}</Show>
          </div>
        </div>
      </Show>
      <Show when={props.large}>
        <div class="tw-navbar__large">
          <h1 class="tw-navbar__title tw-navbar__title--large">{props.title}</h1>
          <Show when={props.leading !== undefined || props.right !== undefined}>
            <div class="tw-navbar__large-actions">
              {props.leading}
              {props.right}
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
