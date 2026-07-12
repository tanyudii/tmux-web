import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMuted, buildBellTitle, shouldPlayBellAlert } from "./notify.js";

test("parseMuted returns false when no preference has been stored yet", () => {
  assert.equal(parseMuted(null), false);
  assert.equal(parseMuted(undefined), false);
});

test("parseMuted returns true only for the exact stored string \"true\"", () => {
  assert.equal(parseMuted("true"), true);
});

test("parseMuted returns false for \"false\" or any unrecognized value", () => {
  assert.equal(parseMuted("false"), false);
  assert.equal(parseMuted("TRUE"), false);
  assert.equal(parseMuted("1"), false);
  assert.equal(parseMuted(""), false);
});

test("buildBellTitle includes the session name so the developer knows which tab rang", () => {
  assert.equal(buildBellTitle("my-feature"), "🔔 my-feature needs you — tmux-web");
});

test("buildBellTitle falls back to a generic label when no session name is available", () => {
  assert.equal(buildBellTitle(null), "🔔 session needs you — tmux-web");
  assert.equal(buildBellTitle(""), "🔔 session needs you — tmux-web");
});

test("shouldPlayBellAlert never alerts while muted, even if the tab is hidden", () => {
  const result = shouldPlayBellAlert({
    muted: true,
    hasFocus: false,
    hidden: true,
    lastAlertAt: null,
    now: 1000,
    cooldownMs: 1500,
  });
  assert.equal(result, false);
});

test("shouldPlayBellAlert stays quiet when the tab is focused and visible", () => {
  const result = shouldPlayBellAlert({
    muted: false,
    hasFocus: true,
    hidden: false,
    lastAlertAt: null,
    now: 1000,
    cooldownMs: 1500,
  });
  assert.equal(result, false);
});

test("shouldPlayBellAlert fires on the first bell when the tab is hidden", () => {
  const result = shouldPlayBellAlert({
    muted: false,
    hasFocus: false,
    hidden: true,
    lastAlertAt: null,
    now: 1000,
    cooldownMs: 1500,
  });
  assert.equal(result, true);
});

test("shouldPlayBellAlert fires when the tab is visible but the browser window lost focus", () => {
  const result = shouldPlayBellAlert({
    muted: false,
    hasFocus: false,
    hidden: false,
    lastAlertAt: null,
    now: 1000,
    cooldownMs: 1500,
  });
  assert.equal(result, true);
});

test("shouldPlayBellAlert suppresses a repeat alert inside the cooldown window", () => {
  const result = shouldPlayBellAlert({
    muted: false,
    hasFocus: false,
    hidden: true,
    lastAlertAt: 1000,
    now: 2000, // 1000ms elapsed, cooldown is 1500ms
    cooldownMs: 1500,
  });
  assert.equal(result, false);
});

test("shouldPlayBellAlert allows a repeat alert once the cooldown has fully elapsed", () => {
  const result = shouldPlayBellAlert({
    muted: false,
    hasFocus: false,
    hidden: true,
    lastAlertAt: 1000,
    now: 2500, // exactly 1500ms elapsed
    cooldownMs: 1500,
  });
  assert.equal(result, true);
});
