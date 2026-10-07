// THE SESSION-ID PINS (FW-MI-A, MI-D1) — core/session.ts's pure surface:
// the shape law, the mint, and the read-or-generate persistence seam (the
// stable per-browser identity the host's session scoping keys on).

import { describe, expect, it } from 'vitest';
import {
  CONSOLE_SESSION_HEADER,
  CONSOLE_SESSION_STORAGE_KEY,
  consoleSessionHeaders,
  consoleSessionIdOf,
  generateConsoleSessionId,
  isConsoleSessionId,
  type SessionRandom,
} from './session';

/** A deterministic random source (count 0xff bytes in sequence — every id is reproducible). */
const sequentialRandom: SessionRandom = (count) => {
  const bytes = new Uint8Array(count);
  for (let index = 0; index < count; index += 1) bytes[index] = (index * 7 + 1) % 256;
  return bytes;
};

/** A map-backed storage seam. */
class MapStorage {
  readonly map = new Map<string, string>();
  readonly writes: string[] = [];
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.writes.push(`${key}=${value}`);
    this.map.set(key, value);
  }
}

describe('core/session — the console session id (FW-MI-A, MI-D1)', () => {
  it('the shape law: 8-64 url-safe characters — well-formed ids pass, everything else is not a session id', () => {
    expect(isConsoleSessionId('a'.repeat(32))).toBe(true);
    expect(isConsoleSessionId('AbC123_-xyz')).toBe(true);
    expect(isConsoleSessionId('short')).toBe(false); // 5 chars
    expect(isConsoleSessionId('a'.repeat(65))).toBe(false); // 65 chars
    expect(isConsoleSessionId('bad chars!')).toBe(false); // the url-safe class only
    expect(isConsoleSessionId('')).toBe(false);
    expect(isConsoleSessionId(null)).toBe(false);
    expect(isConsoleSessionId(12345678)).toBe(false);
  });

  it('the mint: 16 random bytes as 32 lowercase hex — deterministic under an injected source, well-formed always', () => {
    const id = generateConsoleSessionId(sequentialRandom);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(isConsoleSessionId(id)).toBe(true);
    expect(generateConsoleSessionId(sequentialRandom)).toBe(id); // deterministic given the same source
    expect(generateConsoleSessionId(sequentialRandom)).not.toBe(generateConsoleSessionId((count) => new Uint8Array(count))); // the source drives the id
  });

  it('read-or-generate: a stored WELL-FORMED id returns as-is (the stable identity — no re-mint, no storage churn)', () => {
    const storage = new MapStorage();
    storage.map.set(CONSOLE_SESSION_STORAGE_KEY, 'stable-session-id-0001');
    expect(consoleSessionIdOf(storage)).toBe('stable-session-id-0001');
    expect(storage.writes).toEqual([]); // nothing rewritten
  });

  it('read-or-generate: nothing stored mints + persists (the next boot reuses it)', () => {
    const storage = new MapStorage();
    const minted = consoleSessionIdOf(storage, sequentialRandom);
    expect(minted).toMatch(/^[0-9a-f]{32}$/);
    expect(storage.map.get(CONSOLE_SESSION_STORAGE_KEY)).toBe(minted); // persisted under the documented key
    expect(consoleSessionIdOf(storage, sequentialRandom)).toBe(minted); // and the next read returns it
  });

  it('read-or-generate: a MALFORMED stored value is regenerated (never trusted — a foreign format never widens the session)', () => {
    const storage = new MapStorage();
    storage.map.set(CONSOLE_SESSION_STORAGE_KEY, 'not a session id!!');
    const minted = consoleSessionIdOf(storage, sequentialRandom);
    expect(minted).toMatch(/^[0-9a-f]{32}$/);
    expect(storage.map.get(CONSOLE_SESSION_STORAGE_KEY)).toBe(minted); // the malformed value is replaced
  });

  it('read-or-generate: a storage that THROWS degrades to the ephemeral id (this boot is still a coherent session — never a crash)', () => {
    const refusing: { getItem(key: string): string | null; setItem(key: string, value: string): void } = {
      getItem: () => {
        throw new Error('private mode');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    const minted = consoleSessionIdOf(refusing, sequentialRandom);
    expect(minted).toMatch(/^[0-9a-f]{32}$/); // the ephemeral id still identifies this boot's session
  });

  it('the header record: the documented header name mapped to the session id (the client wiring carries exactly this)', () => {
    expect(CONSOLE_SESSION_HEADER).toBe('x-tradrl-console-session');
    expect(consoleSessionHeaders('stable-session-id-0001')).toEqual({ 'x-tradrl-console-session': 'stable-session-id-0001' });
  });
});
