import { test } from "node:test";
import assert from "node:assert/strict";
import { RateLimiter } from "./rate-limit.ts";

function fakeClock(startMs = 0): { now: () => number; advance: (ms: number) => void } {
  let current = startMs;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

test("allows requests up to max within the window", () => {
  const clock = fakeClock();
  const limiter = new RateLimiter({ windowMs: 60_000, max: 3 }, clock.now);

  assert.equal(limiter.check("1.2.3.4").limited, false);
  assert.equal(limiter.check("1.2.3.4").limited, false);
  assert.equal(limiter.check("1.2.3.4").limited, false);
});

test("blocks the request that exceeds max within the window", () => {
  const clock = fakeClock();
  const limiter = new RateLimiter({ windowMs: 60_000, max: 2 }, clock.now);

  limiter.check("1.2.3.4");
  limiter.check("1.2.3.4");
  const result = limiter.check("1.2.3.4");

  assert.equal(result.limited, true);
  assert.equal(result.retryAfterMs, 60_000);
});

test("different keys are tracked independently", () => {
  const clock = fakeClock();
  const limiter = new RateLimiter({ windowMs: 60_000, max: 1 }, clock.now);

  assert.equal(limiter.check("1.2.3.4").limited, false);
  assert.equal(limiter.check("5.6.7.8").limited, false);
  assert.equal(limiter.check("1.2.3.4").limited, true);
});

test("allows requests again once the window has fully elapsed", () => {
  const clock = fakeClock();
  const limiter = new RateLimiter({ windowMs: 60_000, max: 1 }, clock.now);

  assert.equal(limiter.check("1.2.3.4").limited, false);
  assert.equal(limiter.check("1.2.3.4").limited, true);

  clock.advance(60_001);

  assert.equal(limiter.check("1.2.3.4").limited, false);
});

test("retryAfterMs counts down as time passes within the window", () => {
  const clock = fakeClock();
  const limiter = new RateLimiter({ windowMs: 10_000, max: 1 }, clock.now);

  limiter.check("1.2.3.4");
  clock.advance(4_000);
  const result = limiter.check("1.2.3.4");

  assert.equal(result.limited, true);
  assert.equal(result.retryAfterMs, 6_000);
});

test("prune removes keys with no hits left in the current window", () => {
  const clock = fakeClock();
  const limiter = new RateLimiter({ windowMs: 1_000, max: 5 }, clock.now);

  limiter.check("stale-key");
  clock.advance(1_001);
  limiter.prune();

  // A fresh window for the same key should behave as if it were never seen.
  const result = limiter.check("stale-key");
  assert.equal(result.limited, false);
});

test("prune keeps keys that still have hits inside the window", () => {
  const clock = fakeClock();
  const limiter = new RateLimiter({ windowMs: 10_000, max: 1 }, clock.now);

  limiter.check("active-key");
  clock.advance(1_000);
  limiter.prune();

  // Still within the window and already at max -- should still be limited.
  assert.equal(limiter.check("active-key").limited, true);
});
