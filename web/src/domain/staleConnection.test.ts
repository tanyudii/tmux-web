import { describe, expect, it } from "vitest";
import {
  RESUME_RECONNECT_THRESHOLD_MS,
  STALE_INPUT_THRESHOLD_MS,
  shouldProbeReconnect,
  shouldReconnectAfterHidden,
} from "./staleConnection";

describe("shouldProbeReconnect", () => {
  it("returns false when the user has not typed anything", () => {
    expect(shouldProbeReconnect({ lastInputAt: null, lastDataAt: null, now: 1_000_000 })).toBe(false);
  });

  it("returns false for an idle-but-healthy socket that simply has nothing to say", () => {
    // No input sent, hours of silence -- an idle shell, not a dead socket.
    expect(shouldProbeReconnect({ lastInputAt: null, lastDataAt: 1_000, now: 1_000 + 3_600_000 })).toBe(false);
  });

  it("returns false while the keystroke is still within the threshold", () => {
    expect(
      shouldProbeReconnect({ lastInputAt: 1_000, lastDataAt: null, now: 1_000 + STALE_INPUT_THRESHOLD_MS - 1 }),
    ).toBe(false);
  });

  it("returns true once a keystroke has gone unanswered for the threshold", () => {
    expect(shouldProbeReconnect({ lastInputAt: 1_000, lastDataAt: null, now: 1_000 + STALE_INPUT_THRESHOLD_MS })).toBe(
      true,
    );
  });

  it("returns false when data arrived after the keystroke", () => {
    expect(shouldProbeReconnect({ lastInputAt: 1_000, lastDataAt: 1_050, now: 1_000 + 60_000 })).toBe(false);
  });

  it("treats data arriving in the same millisecond as the keystroke as an answer", () => {
    expect(shouldProbeReconnect({ lastInputAt: 1_000, lastDataAt: 1_000, now: 1_000 + 60_000 })).toBe(false);
  });

  it("returns true when the only data predates the keystroke", () => {
    expect(shouldProbeReconnect({ lastInputAt: 5_000, lastDataAt: 4_999, now: 5_000 + STALE_INPUT_THRESHOLD_MS })).toBe(
      true,
    );
  });

  it("honours an overridden threshold", () => {
    expect(shouldProbeReconnect({ lastInputAt: 0, lastDataAt: null, now: 100, thresholdMs: 100 })).toBe(true);
    expect(shouldProbeReconnect({ lastInputAt: 0, lastDataAt: null, now: 99, thresholdMs: 100 })).toBe(false);
  });
});

describe("shouldReconnectAfterHidden", () => {
  it("does not reconnect after a quick alt-tab", () => {
    expect(shouldReconnectAfterHidden(1_500)).toBe(false);
  });

  it("reconnects after the page was hidden past the threshold", () => {
    expect(shouldReconnectAfterHidden(RESUME_RECONNECT_THRESHOLD_MS)).toBe(true);
  });

  it("reconnects after a long lock-screen style absence", () => {
    expect(shouldReconnectAfterHidden(10 * 60_000)).toBe(true);
  });

  it("honours an overridden threshold", () => {
    expect(shouldReconnectAfterHidden(500, 400)).toBe(true);
    expect(shouldReconnectAfterHidden(300, 400)).toBe(false);
  });
});
