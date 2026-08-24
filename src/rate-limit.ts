export interface RateLimiterOptions {
  windowMs: number;
  max: number;
}

export interface RateLimitResult {
  limited: boolean;
  retryAfterMs: number;
}

// Simple in-memory sliding-window counter, keyed by an arbitrary string
// (client IP). Good enough for tmux-web's single-process, single-server
// deployment model -- no need for a shared store across processes.
export class RateLimiter {
  private readonly options: RateLimiterOptions;
  private readonly now: () => number;
  private hits = new Map<string, number[]>();

  constructor(options: RateLimiterOptions, now: () => number = Date.now) {
    this.options = options;
    this.now = now;
  }

  check(key: string): RateLimitResult {
    const now = this.now();
    const windowStart = now - this.options.windowMs;
    const timestamps = (this.hits.get(key) ?? []).filter((t) => t > windowStart);

    if (timestamps.length >= this.options.max) {
      this.hits.set(key, timestamps);
      return { limited: true, retryAfterMs: Math.max(0, timestamps[0] + this.options.windowMs - now) };
    }

    timestamps.push(now);
    this.hits.set(key, timestamps);
    return { limited: false, retryAfterMs: 0 };
  }

  // Prunes keys with no hits left in the current window -- without this the
  // map grows forever for a long-running server as distinct client IPs
  // come and go (each one gets its own array, e.g. dynamic-IP clients
  // reconnecting over days/weeks of uptime).
  prune(): void {
    const now = this.now();
    const windowStart = now - this.options.windowMs;
    for (const [key, timestamps] of this.hits) {
      const fresh = timestamps.filter((t) => t > windowStart);
      if (fresh.length === 0) this.hits.delete(key);
      else this.hits.set(key, fresh);
    }
  }
}
