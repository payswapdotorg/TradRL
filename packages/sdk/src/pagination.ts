// @tradrl/sdk — the pagination/cursor helpers.
//
// THE LAW (Work Order): "pagination/cursor helpers". Pure functions
// over the `Page<T>` shape: presence checks, cursor extraction, and
// the bounded `collectAll` walker (a max-pages guard — a server that
// loops cursors forever cannot spin a client). No ambient state; the
// caller supplies the page fetcher.

import type { Page } from './contracts';

/** `true` when the page has a next cursor (more pages remain). */
export function hasNext<T>(page: Page<T>): boolean {
  return typeof page.nextCursor === 'string' && page.nextCursor.length > 0;
}

/** The next cursor, or null on the last page. */
export function cursorOf<T>(page: Page<T>): string | null {
  return hasNext(page) ? (page.nextCursor as string) : null;
}

/** The number of items on the page. */
export function countOf<T>(page: Page<T>): number {
  return page.items.length;
}

/**
 * Walk every page of a listing, collecting items, until the last page
 * or the max-pages guard fires. The fetcher receives the previous
 * page's cursor (undefined on the first call) and returns the next
 * page; the guard is a hard stop (a looping-cursor server cannot
 * spin the client).
 */
export async function collectAll<T>(
  fetchPage: (cursor: string | undefined) => Promise<Page<T>>,
  options: { readonly maxPages?: number } = {},
): Promise<readonly T[]> {
  const maxPages = options.maxPages ?? 100;
  if (!Number.isInteger(maxPages) || maxPages < 1) {
    throw new Error('collectAll: maxPages must be a positive integer');
  }
  const items: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const fetched = await fetchPage(cursor);
    items.push(...fetched.items);
    if (!hasNext(fetched)) return Object.freeze(items);
    cursor = fetched.nextCursor;
  }
  throw new Error(`collectAll: the listing exceeded the max-pages guard (${maxPages}) — a cursor loop or an oversized listing`);
}

/**
 * Walk every page lazily: an async generator yielding each page
 * (memory-bounded iteration for large listings; the same max-pages
 * guard).
 */
export async function* pagesOf<T>(
  fetchPage: (cursor: string | undefined) => Promise<Page<T>>,
  options: { readonly maxPages?: number } = {},
): AsyncGenerator<Page<T>, void, void> {
  const maxPages = options.maxPages ?? 100;
  if (!Number.isInteger(maxPages) || maxPages < 1) {
    throw new Error('pagesOf: maxPages must be a positive integer');
  }
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const fetched = await fetchPage(cursor);
    yield fetched;
    if (!hasNext(fetched)) return;
    cursor = fetched.nextCursor;
  }
  throw new Error(`pagesOf: the listing exceeded the max-pages guard (${maxPages}) — a cursor loop or an oversized listing`);
}
