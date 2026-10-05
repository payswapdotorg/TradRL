// @tradrl/web-console — the command palette (UX-DESIGN.md §4.14, T051).
//
// THE DISCOVERABILITY BACKSTOP: fuzzy search over navigation targets
// (100% coverage — the charter's hard requirement), projects, jobs,
// notifications and evidence. Keyboard navigable (ArrowUp / ArrowDown
// / Enter / Escape); grouped results with type badges.
//
// This module is PURE: build the index from the workspace state,
// score a query deterministically (same (index, query) -> same
// ranked bytes — no locale, no randomness, no wall clock), and render
// the overlay as VNodes. The app layer owns the open state, the key
// handling and the Enter dispatch.

import type { WorkspaceState } from './workspace';
import { NAV_GROUPS, SHELL_TARGETS, SHELL_TITLES, type ShellTarget } from './nav';
import { unreadCount, NOTICE_TITLES } from './notices';
import type { EvidenceCapsule } from './evidence';
import { capsuleBadgeLabel } from '../render/flow';
import { v, type VNode } from '../render/vtree';

/** One palette entry (a searchable target with a type badge + an action hint). */
export interface PaletteEntry {
  /** The entry's kind badge (NAVIGATION / PROJECT / JOB / NOTIFICATION / EVIDENCE). */
  readonly kind: 'NAVIGATION' | 'PROJECT' | 'JOB' | 'NOTIFICATION' | 'EVIDENCE';
  /** The searchable title. */
  readonly title: string;
  /** The optional secondary line (a subtitle or a detail). */
  readonly subtitle?: string;
  /** The action: a shell target to navigate to (null = open the entity's own surface). */
  readonly target: ShellTarget | null;
  /** The entity reference (data-palette; e.g. job:job-1, notice:ntc-1). */
  readonly ref: string;
  /** The searchable haystack (title + subtitle, lowercased). */
  readonly haystack: string;
}

/** The palette's type-badge order (grouped results, charter §4.14). */
const KIND_ORDER: readonly PaletteEntry['kind'][] = ['NAVIGATION', 'PROJECT', 'JOB', 'NOTIFICATION', 'EVIDENCE'];

/**
 * Build the palette index from the workspace state: ALL FIFTEEN
 * navigation targets (D4's 100% coverage), the project, the jobs, the
 * notices and the evidence capsules.
 */
/** The evidence-capsule view of a state (the erasable-subset law: function types live in named aliases, never inline at annotation depth zero). */
export type CapsulesOf = (state: WorkspaceState) => readonly EvidenceCapsule[];

export function paletteIndex(state: WorkspaceState, capsulesOf: CapsulesOf): readonly PaletteEntry[] {
  const entries: PaletteEntry[] = SHELL_TARGETS.map((target) => {
    const group = NAV_GROUPS.find((candidate) => candidate.label !== undefined && candidate.targets.includes(target));
    return {
      kind: 'NAVIGATION' as const,
      title: SHELL_TITLES[target],
      subtitle: group?.label,
      target,
      ref: `nav:${target}`,
      haystack: `${SHELL_TITLES[target]} ${group?.label ?? ''}`.toLowerCase(),
    };
  });
  if (state.project !== null) {
    entries.push({
      kind: 'PROJECT',
      title: state.project.name,
      subtitle: state.project.id,
      target: 'goal',
      ref: `project:${state.project.id}`,
      haystack: `${state.project.name} ${state.project.id}`.toLowerCase(),
    });
  }
  for (const job of state.jobs) {
    entries.push({
      kind: 'JOB',
      title: job.jobId,
      subtitle: `${job.kind} · ${job.status}`,
      target: 'research',
      ref: `job:${job.jobId}`,
      haystack: `${job.jobId} ${job.kind} ${job.status}`.toLowerCase(),
    });
  }
  for (const notice of state.inbox.notices) {
    entries.push({
      kind: 'NOTIFICATION',
      title: notice.title,
      subtitle: NOTICE_TITLES[notice.kind],
      target: 'inbox',
      ref: `notice:${notice.noticeId}`,
      haystack: `${notice.title} ${NOTICE_TITLES[notice.kind]}`.toLowerCase(),
    });
  }
  for (const capsule of capsulesOf(state)) {
    entries.push({
      kind: 'EVIDENCE',
      title: capsuleBadgeLabel(capsule.capsuleId),
      subtitle: capsule.sourceKind,
      target: 'evidence',
      ref: `capsule:${capsule.capsuleId}`,
      haystack: `${capsule.capsuleId} ${capsule.sourceKind}`.toLowerCase(),
    });
  }
  return entries;
}

/**
 * The fuzzy score of a haystack for a query: a subsequence match on
 * the lowercased query (case-insensitive, order-preserving) — tight
 * runs score higher; no match is -1. DETERMINISTIC.
 */
export function fuzzyScore(haystack: string, query: string): number {
  if (query.length === 0) return 0;
  let score = 0;
  let cursor = 0;
  let run = 0;
  for (const character of query) {
    const found = haystack.indexOf(character, cursor);
    if (found === -1) return -1;
    run = found === cursor ? run + 1 : 1;
    score += 1 + run * 2 + (found === 0 ? 3 : 0);
    cursor = found + 1;
  }
  return score;
}

/** One ranked result (an entry + its score, stable by input order on ties). */
export interface RankedResult { readonly entry: PaletteEntry; readonly score: number; readonly index: number }

/**
 * Rank the index for a query: fuzzy-filtered, grouped by kind badge in
 * the charter's order, best-first inside a group (ties keep the index
 * order — deterministic). An empty query returns every entry grouped
 * in kind order (the palette's opened state).
 */
export function rankPalette(index: readonly PaletteEntry[], query: string): readonly PaletteEntry[] {
  const lowered = query.trim().toLowerCase();
  const ranked: RankedResult[] = [];
  for (let position = 0; position < index.length; position += 1) {
    const score = lowered.length === 0 ? 0 : fuzzyScore(index[position].haystack, lowered);
    if (score >= 0) ranked.push({ entry: index[position], score, index: position });
  }
  // The erasable-subset law: constructor type arguments (new Map<...>) are
  // not in the published subset — the annotation carries the typing instead.
  const byKind: Map<PaletteEntry['kind'], RankedResult[]> = new Map();
  for (const result of ranked) {
    const bucket = byKind.get(result.entry.kind);
    if (bucket === undefined) byKind.set(result.entry.kind, [result]);
    else bucket.push(result);
  }
  const ordered: PaletteEntry[] = [];
  for (const kind of KIND_ORDER) {
    const bucket = byKind.get(kind);
    if (bucket === undefined) continue;
    bucket.sort((a, b) => (b.score - a.score) || (a.index - b.index));
    for (const result of bucket) ordered.push(result.entry);
  }
  return ordered;
}

/** The palette overlay (§4.14): the input, the grouped results with type badges, the keyboard affordances. */
export function paletteOverlay(options: {
  readonly query: string;
  readonly results: readonly PaletteEntry[];
  readonly selected: number;
  readonly unread: number;
}): VNode {
  const groups: { kind: PaletteEntry['kind']; entries: { entry: PaletteEntry; position: number }[] }[] = [];
  let position = 0;
  for (const entry of options.results) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.kind === entry.kind) {
      last.entries.push({ entry, position });
    } else {
      groups.push({ kind: entry.kind, entries: [{ entry, position }] });
    }
    position += 1;
  }
  return v('div', { class: 'palette-backdrop', 'data-action': 'palette-close' }, [
    v('div', { class: 'palette', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Command palette' }, [
      v('input', {
        class: 'palette-input',
        type: 'text',
        value: options.query,
        placeholder: 'Search sections, projects, jobs, notifications, evidence…',
        'aria-label': 'Search',
        'data-palette-input': 'true',
        autocomplete: 'off',
      }, []),
      v('div', { class: 'palette-results', role: 'listbox', 'aria-label': 'Results' }, groups.map((group) => v('div', { class: 'palette-group' }, [
        v('div', { class: 'palette-group-label' }, [group.kind]),
        ...group.entries.map(({ entry, position: entryPosition }) => v('button', {
          class: `palette-item${options.selected === entryPosition ? ' selected' : ''}`,
          type: 'button',
          role: 'option',
          'aria-selected': options.selected === entryPosition ? 'true' : 'false',
          'data-palette-ref': entry.ref,
          ...(entry.target === null ? {} : { 'data-target': entry.target }),
        }, [
          v('span', { class: `palette-badge palette-badge-${entry.kind.toLowerCase()}` }, [entry.kind]),
          v('span', { class: 'palette-item-text' }, [
            v('span', { class: 'palette-item-title' }, [entry.title]),
            ...(entry.subtitle === undefined ? [] : [v('span', { class: 'palette-item-subtitle' }, [entry.subtitle])]),
          ]),
          ...(entry.kind === 'NOTIFICATION' && options.unread > 0 ? [v('span', { class: 'pill-dot pill-dot-6 pill-live' }, [v('span', { class: 'pill-dot-mark pill-mark-live', 'aria-hidden': 'true' }, []), v('span', { class: 'pill-dot-label' }, [`${options.unread} unread`])])] : []),
        ])),
      ]))),
      v('div', { class: 'palette-footer' }, [
        v('span', {}, ['↑ ↓ navigate']),
        v('span', {}, ['Enter open']),
        v('span', {}, ['Esc close']),
      ]),
    ]),
  ]);
}

/** The sidebar's visible "Search ⌘K" affordance (§4.14 — sits under the brand row). */
export function paletteAffordance(): VNode {
  return v('button', { class: 'palette-affordance', 'data-action': 'palette-open', type: 'button', 'aria-label': 'Open the command palette (Ctrl or Cmd plus K)' }, [
    v('span', { class: 'palette-affordance-label' }, ['Search']),
    v('kbd', { class: 'palette-affordance-kbd' }, ['⌘K']),
  ]);
}
