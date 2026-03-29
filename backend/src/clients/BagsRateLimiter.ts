import type { BagsRequestPriority } from './BagsAdapter.js';

interface SharedRateLimitState {
  remaining: number;
  resetAt: number;
  backoffUntil: number;
}

const DEFAULT_STATE: SharedRateLimitState = {
  remaining: 1000,
  resetAt: 0,
  backoffUntil: 0,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class BagsRateLimiter {
  private static readonly states = new Map<string, SharedRateLimitState>();

  static resetAll(): void {
    BagsRateLimiter.states.clear();
  }

  constructor(
    private readonly key: string,
    private readonly random: () => number = Math.random,
  ) {}

  getSnapshot(): SharedRateLimitState {
    return { ...this.getState() };
  }

  async acquire(priority: BagsRequestPriority): Promise<void> {
    for (;;) {
      const nowMs = Date.now();
      const state = this.getState();
      const reserveFloor = priority === 'high' ? 0 : 100;
      const resetWaitMs =
        state.remaining <= reserveFloor && state.resetAt > Math.floor(nowMs / 1000)
          ? (state.resetAt - Math.floor(nowMs / 1000)) * 1000 + 1000
          : 0;
      const jitterMs =
        priority === 'low' && state.remaining <= reserveFloor + 25
          ? Math.floor(this.random() * 250)
          : 0;
      const backoffWaitMs = Math.max(0, state.backoffUntil - nowMs);
      const waitMs = Math.max(resetWaitMs, backoffWaitMs) + jitterMs;

      if (waitMs > 0) {
        await sleep(waitMs);
        continue;
      }

      if (state.remaining > 0) {
        state.remaining -= 1;
      }
      return;
    }
  }

  updateFromHeaders(headers: Headers, status?: number): void {
    const state = this.getState();
    const remaining = headers.get('X-RateLimit-Remaining');
    const reset = headers.get('X-RateLimit-Reset');
    const retryAfter = headers.get('Retry-After');

    if (remaining) {
      const parsed = parseInt(remaining, 10);
      if (Number.isFinite(parsed)) {
        state.remaining = parsed;
      }
    }

    if (reset) {
      const parsed = parseInt(reset, 10);
      if (Number.isFinite(parsed)) {
        state.resetAt = parsed;
      }
    }

    if (retryAfter) {
      const parsed = Number(retryAfter);
      if (Number.isFinite(parsed) && parsed > 0) {
        state.backoffUntil = Date.now() + parsed * 1000;
      }
    } else if (status === 429 && state.resetAt > 0) {
      state.backoffUntil = Math.max(
        state.backoffUntil,
        state.resetAt * 1000 + 1000,
      );
    } else if (status !== 429) {
      state.backoffUntil = 0;
    }
  }

  private getState(): SharedRateLimitState {
    const existing = BagsRateLimiter.states.get(this.key);
    if (existing) {
      return existing;
    }

    const created = { ...DEFAULT_STATE };
    BagsRateLimiter.states.set(this.key, created);
    return created;
  }
}
