// Shared because it drifted: mobile's copy was corrected from a gear (which at
// icon size reads as a sun -- the repo owner reported mistaking it for a
// light/dark toggle) while the desktop sidebar kept the old one, so the same
// action wore two different icons depending on the screen. One definition, one
// icon.
//
// Most icons in this codebase are inline per file and duplicated freely (Trash
// exists four times over). This one is exported instead precisely because
// keeping the two call sites identical is the point.
//
// It is a logout icon rather than a settings icon because that is what the
// action does: connectionSettingsStore.clear() erases the stored token and
// server URL and returns to the Connect screen.
export interface LogoutIconProps {
  /** Defaults to 18 (mobile nav bar); the desktop sidebar row uses 16. */
  size?: number;
}

export function LogoutIcon(props: LogoutIconProps) {
  return (
    <svg
      width={props.size ?? 18}
      height={props.size ?? 18}
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M11.2 5V4a1 1 0 00-1-1H4.2a1 1 0 00-1 1v10a1 1 0 001 1h6a1 1 0 001-1v-1"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M7.8 9h7.2m0 0l-2.3-2.3M15 9l-2.3 2.3"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}
