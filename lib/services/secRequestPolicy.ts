import 'server-only';
import { SecTransportError } from '../types/secTransport';

export interface SecClock {
  now(): number;
  sleep(ms: number): Promise<void>;
  timeout(callback: () => void, ms: number): () => void;
}
export const systemSecClock: SecClock = {
  now: () => Date.now(),
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  timeout: (callback, ms) => { const timer = setTimeout(callback, ms); return () => clearTimeout(timer); },
};

/** Serializes whole operations, including retry waits, across clients in this process.
 * This is not a distributed/global SEC rate limit. Do not attach to public routes/jobs.
 */
export function createSecRequestGate(clock: SecClock) {
  let tail = Promise.resolve();
  let nextStart = 0;
  let cooldownUntil = 0;
  let pending = 0;
  return {
    async run<T>(work: () => Promise<T>): Promise<T> {
      if (pending >= 100) throw new SecTransportError('RATE_LIMITED');
      pending++;
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>(resolve => { release = resolve; });
      await previous;
      try { return await work(); } finally { pending--; release(); }
    },
    async beforeAttempt() {
      const wait = Math.max(nextStart, cooldownUntil) - clock.now();
      if (wait > 60_000) throw new SecTransportError('RATE_LIMITED', null, 0, wait);
      if (wait > 0) await clock.sleep(wait);
      nextStart = clock.now() + 1000;
    },
    defer(ms: number) { cooldownUntil = Math.max(cooldownUntil, clock.now() + ms); },
  };
}
export type SecRequestGate = ReturnType<typeof createSecRequestGate>;
export const sharedSecRequestGate = createSecRequestGate(systemSecClock);

/** Invalid headers are ignored; dates/numeric delays never shorten exponential backoff. */
export function secRetryAfter(value: string | null, now: number): number | null {
  if (!value) return null;
  if (/^\d+$/.test(value.trim())) {
    const ms = Number(value.trim()) * 1000;
    return Number.isFinite(ms) ? ms : null;
  }
  if (!/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed - now) : null;
}
