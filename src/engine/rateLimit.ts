export interface RateLimitWindow {
  limit: number;
  ms: number;
}

export const BATTLE_LIMITS: RateLimitWindow[] = [
  { limit: 5, ms: 60_000 },
  { limit: 30, ms: 3_600_000 },
];

const MAX_KEYS = 10_000;

export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(private windows: RateLimitWindow[]) {}

  take(key: string, now = Date.now()): { ok: true } | { ok: false; retryAfterSec: number } {
    const longest = Math.max(...this.windows.map((w) => w.ms));
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < longest);
    for (const w of this.windows) {
      const inWindow = recent.filter((t) => now - t < w.ms);
      if (inWindow.length >= w.limit) {
        this.hits.set(key, recent);
        return { ok: false, retryAfterSec: Math.max(1, Math.ceil((inWindow[0] + w.ms - now) / 1000)) };
      }
    }
    recent.push(now);
    this.hits.delete(key);
    this.hits.set(key, recent);
    if (this.hits.size > MAX_KEYS) this.hits.delete(this.hits.keys().next().value!);
    return { ok: true };
  }
}
