// iOS grouped-inset-list container -- ports kmp/.../ui/components/
// TmuxGroup.kt (itself a port of ui_kits/ios/chrome.jsx's `Group`). An
// optional uppercase eyebrow `header` above and a helper `footer` line
// below a bordered, xl-radius card panel. Rows inside (typically ListRow)
// own their own dividers/heights; this only supplies the card chrome. The
// header's uppercase transform is pure CSS (text-transform), so the DOM
// text content stays exactly as passed in -- avoids JS locale-uppercasing
// pitfalls for no behavioral gain.
import { Show } from "solid-js";
import type { JSX } from "solid-js";

export interface GroupProps {
  header?: string;
  footer?: string;
  children: JSX.Element;
  class?: string;
}

export function Group(props: GroupProps) {
  return (
    <div class={`tw-group ${props.class ?? ""}`}>
      <Show when={props.header}>
        <p class="tw-group__header">{props.header}</p>
      </Show>
      <div class="tw-group__panel">{props.children}</div>
      <Show when={props.footer}>
        <p class="tw-group__footer">{props.footer}</p>
      </Show>
    </div>
  );
}

/** Hairline divider between rows inside a Group -- matches TmuxGroupDivider. */
export function GroupDivider() {
  return <div class="tw-group__divider" role="separator" />;
}
