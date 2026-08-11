import { describe, expect, test } from "vitest";
import { BELL_COOLDOWN_MS, buildBellTitle, shouldPlayBellAlert } from "./bellAlert";

// Ports kmp/.../domain/BellAlertTest.kt 1:1 (itself a port of public/notify.test.js).
describe("shouldPlayBellAlert", () => {
  test("muted never alerts even while away", () => {
    const result = shouldPlayBellAlert({ muted: true, hasFocus: false, hidden: true, lastAlertAt: null, now: 1000 });

    expect(result).toBe(false);
  });

  test("focused and visible does not alert", () => {
    const result = shouldPlayBellAlert({ muted: false, hasFocus: true, hidden: false, lastAlertAt: null, now: 1000 });

    expect(result).toBe(false);
  });

  test("hidden tab alerts on first bell", () => {
    const result = shouldPlayBellAlert({ muted: false, hasFocus: true, hidden: true, lastAlertAt: null, now: 1000 });

    expect(result).toBe(true);
  });

  test("unfocused but visible window alerts on first bell", () => {
    const result = shouldPlayBellAlert({ muted: false, hasFocus: false, hidden: false, lastAlertAt: null, now: 1000 });

    expect(result).toBe(true);
  });

  test("second bell within cooldown is suppressed", () => {
    const result = shouldPlayBellAlert({
      muted: false,
      hasFocus: false,
      hidden: true,
      lastAlertAt: 1000,
      now: 1000 + BELL_COOLDOWN_MS - 1,
    });

    expect(result).toBe(false);
  });

  test("bell after cooldown elapses alerts again", () => {
    const result = shouldPlayBellAlert({
      muted: false,
      hasFocus: false,
      hidden: true,
      lastAlertAt: 1000,
      now: 1000 + BELL_COOLDOWN_MS,
    });

    expect(result).toBe(true);
  });
});

describe("buildBellTitle", () => {
  test("builds title with session name", () => {
    expect(buildBellTitle("my-session")).toBe("🔔 my-session needs you — tmux-web");
  });

  test("builds fallback title when session name is null or blank", () => {
    expect(buildBellTitle(null)).toBe("🔔 session needs you — tmux-web");
    expect(buildBellTitle("")).toBe("🔔 session needs you — tmux-web");
  });
});
