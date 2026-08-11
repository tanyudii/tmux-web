// Ports kmp/composeApp/.../domain/BellAlert.kt (itself a direct port of the
// pre-KMP public/notify.js's shouldPlayBellAlert/buildBellTitle). Pure
// function: `now`/`lastAlertAt` are passed in rather than read from a
// clock, so it stays testable without faking Date.now().
export const BELL_COOLDOWN_MS = 1500;

export function buildBellTitle(sessionName: string | null): string {
  const label = sessionName ? sessionName : "session";
  return `🔔 ${label} needs you — tmux-web`;
}

export interface ShouldPlayBellAlertInput {
  muted: boolean;
  hasFocus: boolean;
  hidden: boolean;
  lastAlertAt: number | null;
  now: number;
}

export function shouldPlayBellAlert(input: ShouldPlayBellAlertInput): boolean {
  if (input.muted) return false;

  const isAway = input.hidden || !input.hasFocus;
  if (!isAway) return false;

  return input.lastAlertAt === null || input.now - input.lastAlertAt >= BELL_COOLDOWN_MS;
}
