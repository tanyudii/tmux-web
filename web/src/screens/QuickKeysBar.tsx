// Ports kmp/.../ui/terminal/QuickKeysBar.kt. Fixed key set of raw control
// sequences sent through the same onInput path as real typing. Hidden at
// wider viewports via a plain CSS media query (screens.css) rather than
// JS width tracking -- ports Kotlin's `maxWidth >= 600dp` check without
// needing a ResizeObserver just for this.
export interface QuickKeysBarProps {
  onKeyTap: (sequence: string) => void;
}

const KEYS: { label: string; sequence: string }[] = [
  { label: "Esc", sequence: "\x1b" },
  { label: "Tab", sequence: "\t" },
  { label: "^C", sequence: "\x03" },
  { label: "^B", sequence: "\x02" },
  { label: "^D", sequence: "\x04" },
];

export function QuickKeysBar(props: QuickKeysBarProps) {
  return (
    <div class="tw-quick-keys" role="toolbar" aria-label="Quick keys">
      {KEYS.map((key) => (
        <button type="button" class="tw-quick-keys__key" onClick={() => props.onKeyTap(key.sequence)}>
          {key.label}
        </button>
      ))}
    </div>
  );
}
