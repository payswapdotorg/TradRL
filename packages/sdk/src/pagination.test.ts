/**
 * @tradrl/sdk — the pagination/cursor tests: presence checks, the
 * bounded collectors (max-pages guard against looping cursors), and
 * the memory-bounded page generator.
 */

import { describe, expect, it } from 'vitest';

import { collectAll, countOf, cursorOf, hasNext, pagesOf } from './pagination';
import type { Page } from './contracts';

function page<T>(items: readonly T[], nextCursor?: string): Page<T> {
  return nextCursor === undefined ? { items } : { items, nextCursor };
}

describe('the presence checks', () => {
  it('hasNext / cursorOf / countOf', () => {
    const withNext = page([1, 2], 'cur:0123abcd');
    const last = page([3]);
    expect(hasNext(withNext)).toBe(true);
    expect(cursorOf(withNext)).toBe('cur:0123abcd');
    expect(hasNext(last)).toBe(false);
    expect(cursorOf(last)).toBe(null);
    expect(countOf(withNext)).toBe(2);
  });
});

describe('collectAll', () => {
  it('walks every page and collects the items', async () => {
    const pages: readonly Page<number>[] = [page([1, 2], 'a'), page([3, 4], 'b'), page([5])];
    const seenCursors: (string | undefined)[] = [];
    const items = await collectAll(async (cursor) => {
      seenCursors.push(cursor);
      return pages[seenCursors.length - 1]!;
    });
    expect(items).toEqual([1, 2, 3, 4, 5]);
    expect(seenCursors).toEqual([undefined, 'a', 'b']);
  });

  it('the max-pages guard fires on a looping-cursor server', async () => {
    await expect(collectAll(async () => page([1], 'forever'), { maxPages: 3 })).rejects.toThrow('max-pages guard');
  });

  it('a single-page listing never asks twice', async () => {
    let calls = 0;
    const items = await collectAll(async () => {
      calls += 1;
      return page([1]);
    });
    expect(items).toEqual([1]);
    expect(calls).toBe(1);
  });
});

describe('pagesOf (the async generator)', () => {
  it('yields each page lazily', async () => {
    const pages: readonly Page<string>[] = [page(['a'], 'x'), page(['b'])];
    const yielded: Page<string>[] = [];
    for await (const yieldedPage of pagesOf(async (cursor) => pages[cursor === undefined ? 0 : 1]!)) {
      yielded.push(yieldedPage);
    }
    expect(yielded.length).toBe(2);
    expect(yielded[0]!.items).toEqual(['a']);
    expect(yielded[1]!.items).toEqual(['b']);
  });

  it('the same max-pages guard', async () => {
    const generator = pagesOf(async () => page([1], 'loop'), { maxPages: 2 });
    await generator.next();
    await generator.next();
    await expect(generator.next()).rejects.toThrow('max-pages guard');
  });
});
