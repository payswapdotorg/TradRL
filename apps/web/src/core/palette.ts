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
import { DEMO_PROJECT_ID, sessionOwnDesksOf } from './tenant';
import type { EvidenceCapsule } from './evidence';
import type { ProjectRecord } from '../api/contracts';
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

/** The desks the palette indexes (defaults to the session own desks — the FW-34-B §3.8 law). */
export type DesksOf = (state: WorkspaceState) => readonly ProjectRecord[];

/**
 * The default desk listing: the session own desks (core/tenant.ts §3.8 —
 * the demo project, the session-owned rows, the unmarked rows, and the
 * browser's CLAIMED desks — FW-36-B's membership arm, threaded by the
 * app layer through the posture record).
 */
export function sessionDesksForPalette(state: WorkspaceState, claimedDeskIds: readonly string[] = []): readonly ProjectRecord[] {
  return sessionOwnDesksOf(state.projectDirectory, DEMO_PROJECT_ID, claimedDeskIds);
}

export function paletteIndex(state: WorkspaceState, capsulesOf: CapsulesOf, desksOf: DesksOf = sessionDesksForPalette): readonly PaletteEntry[] {
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
  // D-16 (W-29 wave 2): CROSS-PROJECT JUMP ENTRIES — the desks the
  // listing law allows are searchable from the palette (S4's finding:
  // the palette indexed the current project only — a "demo" query
  // while scoped to another desk found nothing, and the Settings
  // select was the only way across desks). Selecting a jump entry
  // switches the workspace's scope (the same user-initiated
  // project-adopted the switcher rides — the D-15 generation guard
  // counts it) and lands on the Goal section, the project's own surface.
  // FW-34-B (Round C register §3.8 — the shared-tenant wall, M1): the
  // DEFAULT listing is the SESSION OWN DESKS (core/tenant.ts's own
  // fold — the demo project, the session-owned rows, the unmarked
  // fallback), so a shared origin's ~60-69 desks never flood the
  // palette with other sessions' work; the caller may pass the WHOLE
  // directory instead (the explicit all-desks disclosure's expanded
  // state — one expander, both surfaces, never a silent wall).
  for (const project of desksOf(state)) {
    if (project.id === state.scope.projectId) continue; // the current project already carries its own entry above — never a duplicate
    entries.push({
      kind: 'PROJECT',
      title: project.name,
      subtitle: `switch desk · ${project.id}`,
      target: 'goal',
      ref: `project:${project.id}`,
      haystack: `${project.name} ${project.id} switch desk`.toLowerCase(),
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
 * runs score higher; no match falls through to the SUBSTITUTION-TOLERANT
 * pass below; -1 only when neither matches. DETERMINISTIC.
 */
export function fuzzyScore(haystack: string, query: string): number {
  if (query.length === 0) return 0;
  const subsequence = subsequenceScore(haystack, query);
  if (subsequence !== -1) return subsequence;
  return correctedScore(haystack, query);
}

/** The subsequence pass (deletion-tolerant — the W-14 matcher S4 measured live: 'evidnce' -> Evidence). */
function subsequenceScore(haystack: string, query: string): number {
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

/**
 * D-16 (W-29 wave 2): THE SUBSTITUTION-TOLERANT PASS. The subsequence
 * matcher absorbs DELETIONS ('evidnce' -> Evidence) but not
 * SUBSTITUTIONS: 'evdance' and 'rezearch' matched nothing (S4's live
 * finding, S2's 'evdance' — the personas' own typos). This pass scores
 * a query against each of the haystack's whitespace tokens by
 * Levenshtein distance with a bounded allowance (a quarter of the
 * longer side, at least one and never more than two — the personas'
 * real typos sit at distance 1-2, and a looser bound starts matching
 * noise; queries shorter than three characters are excluded — a
 * two-character "correction" matches almost anything). A corrected
 * match always scores BELOW a genuine subsequence match of the same
 * query (the weakest three-character subsequence already scores 9; a
 * distance-1 correction scores 3, a distance-2 correction 1) — the
 * sane rank: exact/prefix > subsequence > corrected > no match.
 * DETERMINISTIC (no locale, no normalization — plain character
 * equality).
 */
const CORRECTED_MIN_QUERY = 3;

/** One bounded Levenshtein walk (the classic unit-cost DP, early-exited once a row's minimum passes the allowance — the row minima never decrease). */
function levenshteinWithin(query: string, token: string, allowance: number): number {
  let previous: number[] = [];
  for (let position = 0; position <= token.length; position += 1) previous.push(position);
  for (let at = 1; at <= query.length; at += 1) {
    const current: number[] = [at];
    let rowMinimum = at;
    for (let position = 1; position <= token.length; position += 1) {
      const cost = query.charCodeAt(at - 1) === token.charCodeAt(position - 1) ? 0 : 1;
      const value = Math.min(
        (current[position - 1] ?? 0) + 1, // skip a token character (insert into the query)
        (previous[position - 1] ?? 0) + cost, // substitute / match
        (previous[position] ?? 0) + 1, // skip a query character (delete)
      );
      current.push(value);
      if (value < rowMinimum) rowMinimum = value;
    }
    if (rowMinimum > allowance) return allowance + 1; // early exit — the row minima never decrease
    previous = current;
  }
  return previous[token.length] ?? allowance + 1;
}

/** The substitution-tolerant pass over the haystack's tokens (best corrected score, or -1). */
function correctedScore(haystack: string, query: string): number {
  if (query.length < CORRECTED_MIN_QUERY) return -1;
  let best = -1;
  for (const token of haystack.split(' ')) {
    if (token.length === 0) continue;
    const allowance = Math.min(2, Math.max(1, Math.floor(Math.max(query.length, token.length) / 4)));
    const distance = levenshteinWithin(query, token, allowance);
    if (distance > allowance) continue;
    const score = 3 - distance; // distance 1 -> 3, distance 2 -> 1 — always below a genuine subsequence match
    if (score > best) best = score;
  }
  return best;
}

/**
 * D-16 (W-29 wave 2): parse a palette entry's PROJECT ref (`project:<id>`)
 * into the project id (null for any other ref). The CURRENT project's
 * entry and the cross-project jump entries share the grammar; the app
 * layer switches scope when (and only when) the id is another project.
 */
export function projectRefOf(ref: string): string | null {
  if (!ref.startsWith('project:')) return null;
  const id = ref.slice('project:'.length);
  return id.length > 0 ? id : null;
}

/**
 * D-16 (W-29 wave 2): parse a palette entry's EVIDENCE-CAPSULE ref
 * (`capsule:<id>`) into the capsule id — the §4.9 open key
 * (data-capsule-open). Selecting an evidence entry navigates to the
 * Evidence section AND opens the matched capsule inline (the JOB
 * entries already open their dialog; every entity result behaves the
 * same way now).
 */
export function capsuleRefOf(ref: string): string | null {
  if (!ref.startsWith('capsule:')) return null;
  const id = ref.slice('capsule:'.length);
  return id.length > 0 ? id : null;
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

/** The palette's search glyph (the empty state's icon — hand-authored like the shell's other line marks). */
function searchGlyph(): VNode {
  return v('svg', {
    class: 'ci ci-20',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.75',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    focusable: 'false',
  }, [
    v('circle', { cx: '10.75', cy: '10.75', r: '6.25' }, []),
    v('path', { d: 'M15.5 15.5 20.25 20.25' }, []),
  ]);
}

/**
 * The palette's no-matches state (§4.12's EmptyState law inside the
 * dialog — D3: NEVER a blank region): the icon circle, the title, ONE
 * plain sentence naming the query, exactly ONE primary action (Clear
 * search — it restores the palette's opened state). The empty query
 * can never land here (it matches every entry), so the state is
 * reachable only through a query that matched nothing.
 *
 * FW-34-B (Round C register §3.8 — the shared-tenant wall): when the
 * query DID match desks this session does not own (other sessions'
 * desks on the shared origin), the state discloses them BY COUNT with
 * ONE explicit include-all-desks action — the same disclosure the
 * Settings switcher carries, never a silent wall, never a lost
 * registry (the FW-31-B durability win stays intact: the whole
 * directory remains one explicit expansion away).
 */
function paletteEmpty(query: string, hiddenDeskMatches: number): VNode {
  const trimmed = query.trim();
  return v('div', { class: 'palette-empty', 'data-palette-empty': trimmed, role: 'status' }, [
    v('div', { class: 'empty-circle', 'aria-hidden': 'true' }, [searchGlyph()]),
    v('div', { class: 'empty-title' }, ['No matches']),
    v('p', { class: 'empty-sentence' }, [trimmed.length === 0
      ? 'Nothing matches — try a different search.'
      : `Nothing matches “${trimmed}” — try a different search.`]),
    v('button', { class: 'empty-action', 'data-action': 'palette-clear', type: 'button' }, ['Clear search']),
    ...(hiddenDeskMatches <= 0 ? [] : [
      v('p', { class: 'empty-sentence', 'data-palette-hidden-desks': 'true' }, [
        `${hiddenDeskMatches} other desk${hiddenDeskMatches === 1 ? '' : 's'} in this workspace (other sessions’ — not yours) match “${trimmed}”.`,
      ]),
      v('button', { class: 'empty-action', 'data-action': 'palette-all-desks', type: 'button' }, ['Include all desks in this workspace']),
    ]),
  ]);
}

/** The palette overlay (§4.14): the input, the grouped results with type badges, the keyboard affordances. */
export function paletteOverlay(options: {
  readonly query: string;
  readonly results: readonly PaletteEntry[];
  readonly selected: number;
  readonly unread: number;
  /** FW-34-B §3.8: other sessions desks matching the query when the listing is session-scoped (0 = none / already expanded) — the empty state disclosure. */
  readonly hiddenDeskMatches?: number;
  /** FW-34-B §3.8: true when the listing already includes every desk in the workspace (the expanded state — the disclosure hides itself). */
  readonly allDesks?: boolean;
  /**
   * FW-36-B (Round E register §3.9 — the palette disclosure regression,
   * L1+L3): the TOTAL count of other sessions' desks hidden from this
   * session-scoped listing (0 = none / already expanded). The Round D
   * disclosure lived only in the empty state — a query that MATCHED own
   * desks rendered other sessions' matching desks with no marker at
   * all. The footer now carries the counted "other sessions' — not
   * yours" line + the include-all action on EVERY state, empty or not.
   */
  readonly hiddenDesksTotal?: number;
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
      v('div', { class: 'palette-results', role: 'listbox', 'aria-label': 'Results' }, options.results.length === 0
        ? [paletteEmpty(options.query, options.allDesks === true ? 0 : options.hiddenDeskMatches ?? 0)] // the §4.12 teaching shape — never a blank region
        : groups.map((group) => v('div', { class: 'palette-group' }, [
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
        // FW-36-B (§3.9 — the restored disclosure): the counted
        // other-sessions line + the include-all action ride the footer on
        // EVERY listing state (the empty state keeps its own richer
        // copy); hidden = 0 or the expanded listing renders neither.
        ...((options.allDesks === true || (options.hiddenDesksTotal ?? 0) <= 0)
          ? []
          : [
              v('span', { class: 'palette-footer-desks', 'data-palette-hidden-total': String(options.hiddenDesksTotal) }, [
                `${options.hiddenDesksTotal} other desk${options.hiddenDesksTotal === 1 ? '' : 's'} in this workspace (other sessions’ — not yours) stay hidden`,
              ]),
              v('button', { class: 'empty-action', 'data-action': 'palette-all-desks', type: 'button' }, ['Include all desks']),
            ]),
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
