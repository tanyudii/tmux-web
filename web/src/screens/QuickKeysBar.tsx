// Ports kmp/.../ui/terminal/QuickKeysBar.kt. Fixed key set of raw control
// sequences sent through the same onInput path as real typing. Hidden at
// wider viewports via a plain CSS media query (screens.css) rather than
// JS width tracking -- ports Kotlin's `maxWidth >= 600dp` check without
// needing a ResizeObserver just for this.
//
// It also carries the mobile clipboard controls and the on-screen arrow pad,
// because a phone has no Cmd+C/Cmd+V and no arrow keys to reach the desktop
// paths in terminal/keydownHandlers.ts. Both are optional props: this same
// component is rendered by the desktop pane (hidden by the media query above
// rather than unmounted), which has a real keyboard and needs neither.
//
// THREE mutually exclusive modes share the one row, rather than stacking
// rows: vertical space on a phone belongs to the terminal, and a second bar
// would cost it ~2-3 lines of output permanently.
//
//   normal     Esc Tab ^C ^B ^D  arrows-toggle  Select  Paste
//   arrows     <- ^ v ->  Enter  Shift+Tab  Done
//   selecting  Copy  Clear  Done
//
// In both non-normal modes the control keys are deliberately REPLACED, not
// supplemented. During a selection every one of them would repaint the pane
// and destroy the selection; during menu navigation a stray ^C would kill
// the very prompt being answered.
import { Show } from "solid-js";
import type { VirtualKeyName } from "../domain/virtualKeys";

export interface QuickKeysBarProps {
  onKeyTap: (sequence: string) => void;
  isSelecting?: boolean;
  onToggleSelecting?: (next: boolean) => void;
  onCopy?: () => void;
  onClearSelection?: () => void;
  onPaste?: () => void;
  isArrowMode?: boolean;
  onToggleArrows?: (next: boolean) => void;
  onPressKey?: (name: VirtualKeyName) => void;
}

const KEYS: { label: string; sequence: string }[] = [
  { label: "Esc", sequence: "\x1b" },
  { label: "Tab", sequence: "\t" },
  { label: "^C", sequence: "\x03" },
  { label: "^B", sequence: "\x02" },
  { label: "^D", sequence: "\x04" },
];

// Glyph labels carry an explicit accessible name: "←" announces as nothing
// useful on a screen reader, and the tests address these buttons by name.
const ARROW_KEYS: { glyph: string; label: string; name: VirtualKeyName }[] = [
  { glyph: "←", label: "Left", name: "ArrowLeft" },
  { glyph: "↑", label: "Up", name: "ArrowUp" },
  { glyph: "↓", label: "Down", name: "ArrowDown" },
  { glyph: "→", label: "Right", name: "ArrowRight" },
  { glyph: "⏎", label: "Enter", name: "Enter" },
  { glyph: "⇧⇥", label: "Shift Tab", name: "ShiftTab" },
];

export function QuickKeysBar(props: QuickKeysBarProps) {
  const hasClipboardControls = () => props.onToggleSelecting !== undefined;
  const hasArrowControls = () => props.onToggleArrows !== undefined;
  const isSelecting = () => props.isSelecting === true;
  const isArrowMode = () => props.isArrowMode === true;

  const toolbarLabel = () => (isSelecting() ? "Text selection" : isArrowMode() ? "Arrow keys" : "Quick keys");

  return (
    <div
      class="tw-quick-keys"
      classList={{
        "tw-quick-keys--selecting": isSelecting(),
        "tw-quick-keys--arrows": isArrowMode(),
      }}
      role="toolbar"
      aria-label={toolbarLabel()}
    >
      <Show when={isSelecting()}>
        <button type="button" class="tw-quick-keys__key tw-quick-keys__key--primary" onClick={() => props.onCopy?.()}>
          Copy
        </button>
        <button type="button" class="tw-quick-keys__key" onClick={() => props.onClearSelection?.()}>
          Clear
        </button>
        <button
          type="button"
          class="tw-quick-keys__key"
          aria-pressed={true}
          onClick={() => props.onToggleSelecting?.(false)}
        >
          Done
        </button>
      </Show>

      {/* Selection wins if both flags are somehow set at once. TerminalScreen
          already makes the two modes mutually exclusive, but the row must
          never render two modes stacked on top of each other if that ever
          slips -- one of them would be unreachable behind the other. */}
      <Show when={isArrowMode() && !isSelecting()}>
        {ARROW_KEYS.map((key) => (
          <button
            type="button"
            class="tw-quick-keys__key tw-quick-keys__key--glyph"
            aria-label={key.label}
            onClick={() => props.onPressKey?.(key.name)}
          >
            {key.glyph}
          </button>
        ))}
        <button
          type="button"
          class="tw-quick-keys__key"
          aria-pressed={true}
          onClick={() => props.onToggleArrows?.(false)}
        >
          Done
        </button>
      </Show>

      <Show when={!isSelecting() && !isArrowMode()}>
        {KEYS.map((key) => (
          <button type="button" class="tw-quick-keys__key" onClick={() => props.onKeyTap(key.sequence)}>
            {key.label}
          </button>
        ))}
        <Show when={hasArrowControls()}>
          <button
            type="button"
            class="tw-quick-keys__key tw-quick-keys__key--glyph"
            aria-label="Arrow keys"
            aria-pressed={false}
            onClick={() => props.onToggleArrows?.(true)}
          >
            ⇅
          </button>
        </Show>
        <Show when={hasClipboardControls()}>
          <button
            type="button"
            class="tw-quick-keys__key tw-quick-keys__key--primary"
            aria-pressed={false}
            onClick={() => props.onToggleSelecting?.(true)}
          >
            Select
          </button>
          <button type="button" class="tw-quick-keys__key" onClick={() => props.onPaste?.()}>
            Paste
          </button>
        </Show>
      </Show>
    </div>
  );
}
