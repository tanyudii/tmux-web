// Ports kmp/.../ui/terminal/QuickKeysBar.kt. Fixed key set of raw control
// sequences sent through the same onInput path as real typing. Hidden at
// wider viewports via a plain CSS media query (screens.css) rather than
// JS width tracking -- ports Kotlin's `maxWidth >= 600dp` check without
// needing a ResizeObserver just for this.
//
// It also carries the mobile clipboard controls and the on-screen arrow pad,
// because a phone has no Cmd+C/Cmd+V and no arrow keys to reach the desktop
// paths in terminal/keydownHandlers.ts.
//
// Those clusters are optional props, but NOT because a desktop caller
// omits them: TerminalScreen is the only thing that renders this bar at all
// (App.tsx routes desktop to WebShellPage, a separate tree that never mounts
// TerminalScreen, and WebMainPane deliberately has no quick-keys bar), and it
// always supplies every handler. The media query above still matters -- it
// hides the bar when TerminalScreen itself is shown at >=600px, e.g. a phone
// in landscape -- but the optionality is currently unused flexibility rather
// than a live desktop/mobile distinction.
//
// FOUR mutually exclusive modes share the bar, rather than stacking rows:
// vertical space on a phone belongs to the terminal, and a second bar would
// cost it ~2-3 lines of output permanently. (Ctrl mode is the one exception
// -- it wraps onto a second row for its duration, but Done returns the
// terminal to full height; it is a pad you hold open, not chrome that stays.)
//
//   normal     Esc Tab ^C ^B  arrows-toggle  ctrl-toggle  Select  Paste
//   arrows     <- ^ v ->  Enter  Shift+Tab  Done
//   ctrl       ^A ^B ^C ^D ^E ^K / ^L ^R ^U ^W ^Z  Done  (wraps to 2 rows)
//   selecting  Copy  Clear  Done
//
// In every non-normal mode the control keys are deliberately REPLACED, not
// supplemented. During a selection every one of them would repaint the pane
// and destroy the selection; during menu navigation a stray ^C would kill
// the very prompt being answered; in ctrl mode a stray Esc/Tab alongside the
// pad would send bytes the user never asked for.
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
  isCtrlMode?: boolean;
  onToggleCtrl?: (next: boolean) => void;
}

const KEYS: { label: string; sequence: string }[] = [
  { label: "Esc", sequence: "\x1b" },
  { label: "Tab", sequence: "\t" },
  { label: "^C", sequence: "\x03" },
  { label: "^B", sequence: "\x02" },
];

// The full ctrl pad, opened from the "^" toggle in the normal row. ^B and ^C
// repeat here from the normal row on purpose: this pad is "every Ctrl key in
// one place", and a user who knows they want ^B mid-session should not have
// to remember it ALSO lives outside the pad. Every entry is a fixed single
// byte (Ctrl+letter = letter code - 0x40), so they go straight down the
// onKeyTap raw-byte path -- unlike arrows, whose wire form depends on the
// terminal's cursor key mode and must go through xterm instead.
const CTRL_KEYS: { label: string; sequence: string }[] = [
  { label: "^A", sequence: "\x01" }, // readline: start of line
  { label: "^B", sequence: "\x02" }, // readline: back char (tmux prefix)
  { label: "^C", sequence: "\x03" }, // SIGINT
  { label: "^D", sequence: "\x04" }, // EOF / forward delete
  { label: "^E", sequence: "\x05" }, // readline: end of line
  { label: "^K", sequence: "\x0b" }, // readline: kill to end of line
  { label: "^L", sequence: "\x0c" }, // redraw / clear screen
  { label: "^R", sequence: "\x12" }, // reverse history search
  { label: "^U", sequence: "\x15" }, // readline: kill to start of line
  { label: "^W", sequence: "\x17" }, // readline: kill previous word
  { label: "^Z", sequence: "\x1a" }, // SIGTSTP (suspend; resume with fg)
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
  const hasCtrlControls = () => props.onToggleCtrl !== undefined;
  const isSelecting = () => props.isSelecting === true;
  const isArrowMode = () => props.isArrowMode === true;
  const isCtrlMode = () => props.isCtrlMode === true;

  const toolbarLabel = () =>
    isSelecting() ? "Text selection" : isArrowMode() ? "Arrow keys" : isCtrlMode() ? "Control keys" : "Quick keys";

  return (
    <div
      class="tw-quick-keys"
      classList={{
        "tw-quick-keys--selecting": isSelecting(),
        "tw-quick-keys--arrows": isArrowMode(),
        "tw-quick-keys--ctrl": isCtrlMode(),
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
          already makes the modes mutually exclusive, but the bar must never
          render two modes stacked on top of each other if that ever slips --
          one of them would be unreachable behind the other. Arrows in turn
          win over ctrl: the arrow pad is the one you hold open while driving
          a menu, which is exactly when a stray ctrl byte is worst. */}
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

      <Show when={isCtrlMode() && !isSelecting() && !isArrowMode()}>
        {CTRL_KEYS.map((key) => (
          <button type="button" class="tw-quick-keys__key" onClick={() => props.onKeyTap(key.sequence)}>
            {key.label}
          </button>
        ))}
        <button
          type="button"
          class="tw-quick-keys__key"
          aria-pressed={true}
          onClick={() => props.onToggleCtrl?.(false)}
        >
          Done
        </button>
      </Show>

      <Show when={!isSelecting() && !isArrowMode() && !isCtrlMode()}>
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
        <Show when={hasCtrlControls()}>
          <button
            type="button"
            class="tw-quick-keys__key tw-quick-keys__key--glyph"
            aria-label="Control keys"
            aria-pressed={false}
            onClick={() => props.onToggleCtrl?.(true)}
          >
            ^
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
