// Web bell delivery: title flash + beep + Notification -- ports
// kmp/.../terminal/BellFeedback.wasmJs.kt. All three are best-effort and
// independent (each wrapped in its own try/catch) so e.g. a browser that
// blocks Web Audio still gets the title flash and vice versa.
//
// Not called from TerminalView.tsx itself -- like the Kotlin original, the
// terminal binding only forwards the raw bell event upward; whether to
// actually flash/beep/notify (respecting cooldown/away-detection, see
// domain/bellAlert.ts) is the screen/ViewModel layer's decision, made in
// Phase 6.
const BELL_FLASH_INTERVAL_MS = 1000;

interface BellWindow extends Window {
  _tmuxBell?: {
    alertTitle: string;
    originalTitle: string;
    intervalId: ReturnType<typeof setInterval> | null;
  };
}

export function triggerBellFeedback(title: string): void {
  playBellBeep();
  flashBellTitle(title);
  showBellNotification(title);
}

/** A short synthesized tone via the Web Audio API -- no audio asset to ship or fetch. */
function playBellBeep(): void {
  try {
    const AudioCtx =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.15);
    oscillator.onended = () => void ctx.close();
  } catch {
    // Some browsers require a prior user gesture before any AudioContext
    // will actually produce sound -- silently no-op rather than throwing.
  }
}

/** Alternates document.title between `title` and whatever it was before, until the tab is visible and focused again. */
function flashBellTitle(title: string): void {
  const bellWindow = window as BellWindow;
  if (!bellWindow._tmuxBell) {
    bellWindow._tmuxBell = { alertTitle: title, originalTitle: document.title, intervalId: null };
  }
  const state = bellWindow._tmuxBell;
  state.alertTitle = title;
  if (state.intervalId) return;
  state.originalTitle = document.title;

  let showingAlert = false;
  state.intervalId = setInterval(() => {
    document.title = showingAlert ? state.originalTitle : state.alertTitle;
    showingAlert = !showingAlert;
  }, BELL_FLASH_INTERVAL_MS);

  const stop = (): void => {
    if (!state.intervalId) return;
    clearInterval(state.intervalId);
    state.intervalId = null;
    document.title = state.originalTitle;
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", onVisible);
  };
  const onVisible = (): void => {
    if (!document.hidden && document.hasFocus()) stop();
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
}

/**
 * Only fires when permission was already granted by an earlier explicit
 * user action -- deliberately never calls Notification.requestPermission()
 * itself. Auto-prompting from a bell event (not a user gesture) would
 * either be silently ignored by the browser or burn the one permission
 * prompt a user gets before having to dig through browser site-settings.
 */
function showBellNotification(title: string): void {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    new Notification(title, { body: "tmux-web", tag: "tmux-web-bell" });
  } catch {
    // Best-effort.
  }
}
