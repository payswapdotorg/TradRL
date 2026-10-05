// @tradrl/web-console — THE COMPONENT SYSTEM part 1 (UX-DESIGN.md
// §4.1-§4.6 + §4.12, T051).
//
// Pure VNode component builders — same (props) -> identical bytes; no
// DOM, no clock, no randomness. The section render models
// (render/model.ts) compose these; the projector (render/dom.ts)
// remains a mechanical translation. Styling lives in
// src/shell/shell.css on the §1 token system.
//
// Laws each component carries:
//   §4.1 stat cards: 14px icon + 0.7rem uppercase tracking label,
//     text-lg semibold TABULAR value, ok -> foreground /
//     not-ok -> muted-foreground, optional one-line delta.
//   §4.2 rich stat card: rounded-2xl card/70, hairline border, inset
//     ring, 0.7rem uppercase eyebrow, big value + qualifier, ONE full
//     human sentence, border-top + 3-column <dl>.
//   §4.3 status pills + dots: 6/8/10px dot + label — NEVER color
//     alone; connection states map to §1.3; domain states
//     (submitted/running/complete/failed/blocked) map semantically.
//   §4.4 interactive list rows: full-width, rounded, hairline border,
//     card background, leading icon tile (36-44px, ring), label +
//     status pill, trailing chevron (translate-x on hover), selected
//     and disabled (opacity-60) states.
//   §4.5 detail views: (a) the right-side sheet (max-width 28rem,
//     slide-in, backdrop, focus trap — the app layer wires Esc/Tab);
//     (b) the inline accordion ("Show details"/"Hide details", chevron
//     rotate-180) revealing a definition grid under 0.65rem uppercase
//     eyebrows (STATUS / METRICS / IDENTITY / ADVANCED).
//   §4.6 timelines: period buckets (core/timeline.ts), severity-tinted
//     icon circles, HH:MM tabular times, semibold titles, the latest
//     row tinted, expandable typed-slug details.
//   §4.12 teaching states: EmptyState (dashed hairline, centered icon
//     circle, title + ONE sentence + exactly ONE primary action);
//     ErrorState (role=alert, soft rose circle, one sentence, ONE
//     "Try again" pill — raw error text ONLY inside an expandable
//     "Technical details" mono block); LoadingState (layout-mirroring
//     skeletons — no spinners outside pending buttons).

import { formatTimeUtc } from '../core/timeline';
import type { ConnectionClass } from './shell';
import { v, type VNode } from './vtree';

// ---------------------------------------------------------------------------
// Icons (hand-authored 16px line marks; stroke = currentColor).
// ---------------------------------------------------------------------------

/** A hand-authored line icon (viewBox 24; stroke follows currentColor). */
function icon(paths: readonly VNode[], extraClass: string, strokeWidth = '1.75'): VNode {
  return v('svg', {
    class: extraClass,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': strokeWidth,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    focusable: 'false',
  }, paths);
}

const P = (d: string): VNode => v('path', { d }, []);
const C = (cx: string, cy: string, r: string): VNode => v('circle', { cx, cy, r }, []);
const RECT = (x: string, y: string, width: string, height: string, rx: string): VNode => v('rect', { x, y, width, height, rx }, []);

/** A calm glyph per semantic slot (closed vocabulary). */
export type ComponentIcon =
  | 'spark' | 'clock' | 'check' | 'alert' | 'flask' | 'layers'
  | 'pulse' | 'shield' | 'inbox' | 'box' | 'target' | 'chart';

/** One icon glyph renderer (the erasable-subset law: function types live in named aliases, never inline at annotation depth zero). */
type IconGlyph = (extraClass: string) => VNode;

/** The semantic-slot -> glyph mapping (the lookup-map alternative to switch/case — the erasable subset's own remedy). */
const ICON_GLYPHS: Readonly<Record<ComponentIcon, IconGlyph>> = Object.freeze({
  spark: (extraClass) => icon([P('M12 3.5 13.7 9l5.5 1.7-5.5 1.7L12 18l-1.7-5.6L4.8 10.7 10.3 9Z')], extraClass),
  clock: (extraClass) => icon([C('12', '12', '8.25'), P('M12 7.25V12l3.25 2.25')], extraClass),
  check: (extraClass) => icon([C('12', '12', '8.25'), P('M8.4 12.2l2.3 2.3 4.9-4.9')], extraClass),
  alert: (extraClass) => icon([P('M12 4 20 19.5H4Z'), P('M12 10v4.25'), v('circle', { cx: '12', cy: '16.9', r: '0.9', fill: 'currentColor', stroke: 'none' }, [])], extraClass),
  flask: (extraClass) => icon([P('M10 3.5h4M11 3.5v5.2L5.6 18.4A1.6 1.6 0 0 0 7 20.5h10a1.6 1.6 0 0 0 1.4-2.1L13 8.7V3.5M8.2 14.5h7.6')], extraClass),
  layers: (extraClass) => icon([RECT('4', '5', '16', '5.5', '2'), RECT('4', '13.5', '16', '5.5', '2')], extraClass),
  pulse: (extraClass) => icon([P('M3.75 12h4l2.25-6 3.5 12 2.25-6h4.75')], extraClass),
  shield: (extraClass) => icon([P('M12 3.5 19 6v5.2c0 4.8-2.9 8.1-7 9.3-4.1-1.2-7-4.5-7-9.3V6Z')], extraClass),
  inbox: (extraClass) => icon([P('M7 16v-4.5a5 5 0 0 1 10 0V16l1.75 2.75H5.25Z'), P('M10.25 20.25a2 2 0 0 0 3.5 0')], extraClass),
  box: (extraClass) => icon([RECT('4', '7', '16', '11', '3.5'), P('M4 11.5h16')], extraClass),
  target: (extraClass) => icon([C('12', '12', '8.25'), C('12', '12', '4'), v('circle', { cx: '12', cy: '12', r: '0.9', fill: 'currentColor', stroke: 'none' }, [])], extraClass),
  chart: (extraClass) => icon([P('M4.5 20h15'), P('M7.5 20v-6'), P('M12 20V9.5'), P('M16.5 20v-9.5')], extraClass),
});

/** The icon mark of a semantic slot (deterministic, closed set). */
export function iconOf(name: ComponentIcon, extraClass = 'ci ci-16'): VNode {
  return ICON_GLYPHS[name](extraClass);
}

/** The trailing chevron (translates on hover; rotates 180 in the open accordion). */
function chevron(extraClass: string): VNode {
  return icon([P('M9 5.5 15.5 12 9 18.5')], extraClass, '2');
}

// ---------------------------------------------------------------------------
// §4.3 Status pills and dots — NEVER color alone (dot + label always).
// ---------------------------------------------------------------------------

/** The pill tones (each maps to a §1.3 token triple). */
export type PillTone = 'live' | 'warn' | 'down' | 'idle';

/** The connection-class -> pill-tone mapping (§1.3's own classes). */
export function pillToneOfConnection(connection: ConnectionClass): PillTone {
  return connection;
}

/** The domain job states (the charter's own closed list). */
export type DomainState = 'submitted' | 'running' | 'complete' | 'failed' | 'blocked';

/** The domain-state -> pill-tone mapping (§4.3's semantic mapping). */
export function pillToneOfDomain(state: DomainState): PillTone {
  if (state === 'running') return 'live';
  if (state === 'complete') return 'live';
  if (state === 'failed') return 'down';
  if (state === 'blocked') return 'warn';
  return 'idle';
}

/** A dot (6/8/10px) + label pair — the §4.3 primitive; never color alone. */
export function statusDot(tone: PillTone, label: string, size: 6 | 8 | 10 = 8, extraClass = ''): VNode {
  return v('span', { class: `pill-dot pill-dot-${size} pill-${tone}${extraClass.length > 0 ? ` ${extraClass}` : ''}` }, [
    v('span', { class: `pill-dot-mark pill-dot-mark-${size} pill-mark-${tone}`, 'aria-hidden': 'true' }, []),
    v('span', { class: 'pill-dot-label' }, [label]),
  ]);
}

/** A status pill (outline pill carrying a dot + label). */
export function statusPill(tone: PillTone, label: string, extraClass = ''): VNode {
  return v('span', { class: `status-pill pill-${tone}${extraClass.length > 0 ? ` ${extraClass}` : ''}` }, [
    v('span', { class: `pill-mark pill-mark-${tone}`, 'aria-hidden': 'true' }, []),
    v('span', { class: 'pill-label' }, [label]),
  ]);
}

// ---------------------------------------------------------------------------
// §4.1 Stat cards (KPI tiles).
// ---------------------------------------------------------------------------

/** One KPI stat card's props. */
export interface StatCardProps {
  /** The 14px semantic icon. */
  readonly icon: ComponentIcon;
  /** The 0.7rem uppercase tracking muted label. */
  readonly label: string;
  /** The text-lg semibold tabular value (render verbatim — exact decimals). */
  readonly value: string;
  /** Value health: ok -> foreground, not-ok -> muted-foreground. */
  readonly ok?: boolean;
  /** The optional one-line delta under the value. */
  readonly delta?: string;
}

/** One KPI tile (§4.1). */
export function statCard(props: StatCardProps): VNode {
  return v('div', { class: `stat-card${props.ok === false ? ' stat-not-ok' : ''}`, 'data-stat': props.label }, [
    v('div', { class: 'stat-label-row' }, [
      iconOf(props.icon, 'ci ci-14'),
      v('span', { class: 'stat-label' }, [props.label]),
    ]),
    v('div', { class: 'stat-value' }, [props.value]),
    ...(props.delta === undefined ? [] : [v('div', { class: 'stat-delta' }, [props.delta])]),
  ]);
}

/** The KPI tile grid: 2-col narrow, 4-col from 640px (§4.1). */
export function statGrid(cards: readonly VNode[]): VNode {
  return v('div', { class: 'stat-grid' }, [...cards]);
}

// ---------------------------------------------------------------------------
// §4.2 The rich stat card (the "PATH QUALITY" pattern).
// ---------------------------------------------------------------------------

/** The rich stat card's props. */
export interface RichStatCardProps {
  /** The 0.7rem uppercase eyebrow. */
  readonly eyebrow: string;
  /** The big value (semibold, tabular). */
  readonly value: string;
  /** The value's qualifier (e.g. "Good · 42 ms"). */
  readonly qualifier?: string;
  /** ONE full human sentence beneath the value. */
  readonly sentence: string;
  /** The 3-column definition list pairs (dt 0.7rem muted / dd text-sm medium tabular). */
  readonly details: readonly (readonly [string, string])[];
}

/** The rich stat card (§4.2). */
export function richStatCard(props: RichStatCardProps): VNode {
  return v('div', { class: 'rich-stat-card', 'data-rich-stat': props.eyebrow }, [
    v('div', { class: 'rich-eyebrow' }, [props.eyebrow]),
    v('div', { class: 'rich-value-row' }, [
      v('span', { class: 'rich-value' }, [props.value]),
      ...(props.qualifier === undefined ? [] : [v('span', { class: 'rich-qualifier' }, [props.qualifier])]),
    ]),
    v('p', { class: 'rich-sentence' }, [props.sentence]),
    v('dl', { class: 'rich-dl' }, props.details.map(([term, detail]) => v('div', { class: 'rich-dl-item' }, [
      v('dt', {}, [term]),
      v('dd', {}, [detail]),
    ]))),
  ]);
}

// ---------------------------------------------------------------------------
// §4.4 Interactive list rows.
// ---------------------------------------------------------------------------

/** One list row's props (the button row — opens a detail view). */
export interface ListRowProps {
  /** The leading icon tile's semantic icon. */
  readonly icon: ComponentIcon;
  /** The row's title (semibold). */
  readonly title: string;
  /** The optional muted one-line subtitle. */
  readonly subtitle?: string;
  /** The optional trailing status pill (tone + label). */
  readonly pill?: { readonly tone: PillTone; readonly label: string };
  /** The optional right-aligned meta text (tabular). */
  readonly meta?: string;
  /** Selected state (border-foreground/30 + accent tint). */
  readonly selected?: boolean;
  /** Disabled/offline rows render at opacity-60. */
  readonly disabled?: boolean;
  /** The row's interaction payload (data-row; the app opens the sheet). */
  readonly rowId: string;
  /** Extra attributes (e.g. data-section preservation). */
  readonly attrs?: Readonly<Record<string, string>>;
}

/** One interactive list row (§4.4) — a full-width button with a trailing chevron. */
export function listRow(props: ListRowProps): VNode {
  const attrs: Record<string, string> = {
    class: `list-row${props.selected === true ? ' selected' : ''}${props.disabled === true ? ' disabled' : ''}`,
    'data-row': props.rowId,
    type: 'button',
    ...(props.attrs ?? {}),
  };
  if (props.disabled === true) attrs['aria-disabled'] = 'true';
  return v('button', attrs, [
    v('span', { class: 'row-tile', 'aria-hidden': 'true' }, [iconOf(props.icon, 'ci ci-18')]),
    v('span', { class: 'row-text' }, [
      v('span', { class: 'row-title' }, [props.title]),
      ...(props.subtitle === undefined ? [] : [v('span', { class: 'row-subtitle' }, [props.subtitle])]),
    ]),
    ...(props.pill === undefined ? [] : [statusPill(props.pill.tone, props.pill.label, 'row-pill')]),
    ...(props.meta === undefined ? [] : [v('span', { class: 'row-meta' }, [props.meta])]),
    chevron('row-chevron'),
  ]);
}

// ---------------------------------------------------------------------------
// §4.5 Detail views: the definition grid + the accordion + the sheet.
// ---------------------------------------------------------------------------

/** One definition-grid section: a 0.65rem uppercase eyebrow + dt/dd pairs. */
export interface DefinitionSection {
  readonly eyebrow: string;
  readonly pairs: readonly (readonly [string, string])[];
}

/** The definition grid (dt muted/70, dd font-mono text-xs) under uppercase eyebrows. */
export function definitionGrid(sections: readonly DefinitionSection[]): VNode[] {
  return sections.map((section) => v('div', { class: 'def-section', 'data-def': section.eyebrow }, [
    v('div', { class: 'def-eyebrow' }, [section.eyebrow]),
    v('dl', { class: 'def-grid' }, section.pairs.map(([term, detail]) => v('div', { class: 'def-item' }, [
      v('dt', {}, [term]),
      v('dd', {}, [detail]),
    ]))),
  ]));
}

/** One accordion row's props (the inline detail view, §4.5b). */
export interface AccordionRowProps extends ListRowProps {
  /** The definition sections revealed by the expansion. */
  readonly details: readonly DefinitionSection[];
}

/**
 * The inline accordion row (§4.5b): "Show details"/"Hide details" with a
 * chevron that rotates 180deg — a native <details> element, so the
 * toggle needs zero JS (the label swap is CSS on [open]); the revealed
 * content is the definition grid.
 */
export function accordionRow(props: AccordionRowProps): VNode {
  return v('details', {
    class: `list-row accordion-row${props.selected === true ? ' selected' : ''}${props.disabled === true ? ' disabled' : ''}`,
    'data-row': props.rowId,
    ...(props.attrs ?? {}),
  }, [
    v('summary', { class: 'row-summary' }, [
      v('span', { class: 'row-tile', 'aria-hidden': 'true' }, [iconOf(props.icon, 'ci ci-18')]),
      v('span', { class: 'row-text' }, [
        v('span', { class: 'row-title' }, [props.title]),
        ...(props.subtitle === undefined ? [] : [v('span', { class: 'row-subtitle' }, [props.subtitle])]),
      ]),
      ...(props.pill === undefined ? [] : [statusPill(props.pill.tone, props.pill.label, 'row-pill')]),
      ...(props.meta === undefined ? [] : [v('span', { class: 'row-meta' }, [props.meta])]),
      v('span', { class: 'row-toggle' }, [
        v('span', { class: 'when-closed' }, ['Show details']),
        v('span', { class: 'when-open' }, ['Hide details']),
        chevron('row-chevron'),
      ]),
    ]),
    v('div', { class: 'row-details' }, definitionGrid(props.details)),
  ]);
}

/** The right-side sheet's props (§4.5a). */
export interface SheetProps {
  /** The sheet's semantic id (data-sheet; e.g. "job:job-1"). */
  readonly sheetId: string;
  /** The sheet's title. */
  readonly title: string;
  /** The optional muted subtitle. */
  readonly subtitle?: string;
  /** The definition sections (STATUS / METRICS / IDENTITY / ADVANCED). */
  readonly details: readonly DefinitionSection[];
}

/**
 * The right-side sheet (§4.5a): max-width 28rem, slides in, backdrop,
 * the app layer traps focus while open (Esc + backdrop + the close
 * button all close). Rendered only in the open state — the slide is
 * the CSS transition on insertion.
 */
export function detailSheet(props: SheetProps): VNode[] {
  return [
    v('button', { class: 'sheet-backdrop', 'data-action': 'sheet-close', type: 'button', 'aria-label': 'Close details' }, []),
    v('aside', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': props.title, 'data-sheet': props.sheetId }, [
      v('header', { class: 'sheet-header' }, [
        v('div', { class: 'sheet-heading' }, [
          v('div', { class: 'sheet-title' }, [props.title]),
          ...(props.subtitle === undefined ? [] : [v('div', { class: 'sheet-subtitle' }, [props.subtitle])]),
        ]),
        v('button', { class: 'icon-button', 'data-action': 'sheet-close', type: 'button', 'aria-label': 'Close details' }, [icon([P('M6 6l12 12M18 6 6 18')], 'ci ci-16', '2')]),
      ]),
      v('div', { class: 'sheet-body' }, definitionGrid(props.details)),
    ]),
  ];
}

// ---------------------------------------------------------------------------
// §4.6 Timelines.
// ---------------------------------------------------------------------------

/** One rendered timeline row group (a bucket's rows). */
export function timelineList(buckets: readonly { label: string; entries: readonly { at: number; title: string; description?: string; slug?: string; severity?: 'info' | 'warn' | 'error' }[] }[]): VNode {
  let seenFirst = false;
  const severityIcon: Record<'info' | 'warn' | 'error', ComponentIcon> = { info: 'check', warn: 'pulse', error: 'alert' };
  return v('div', { class: 'timeline' }, buckets.map((bucket) => v('section', { class: 'timeline-bucket', 'data-period': bucket.label }, [
    v('div', { class: 'timeline-period' }, [bucket.label]),
    ...bucket.entries.map((entry) => {
      const latest = !seenFirst;
      seenFirst = true;
      const severity = entry.severity ?? 'info';
      return v('details', { class: `timeline-row${latest ? ' latest' : ''}`, 'data-timeline': entry.slug ?? entry.title }, [
        v('summary', { class: 'timeline-summary' }, [
          v('span', { class: `timeline-icon sev-${severity}`, 'aria-hidden': 'true' }, [iconOf(severityIcon[severity], 'ci ci-16')]),
          v('span', { class: 'timeline-time' }, [formatTimeUtc(entry.at)]),
          v('span', { class: 'timeline-text' }, [
            v('span', { class: 'timeline-title' }, [entry.title]),
            ...(entry.description === undefined ? [] : [v('span', { class: 'timeline-desc' }, [entry.description])]),
          ]),
          chevron('row-chevron timeline-chevron'),
        ]),
        ...(entry.slug === undefined ? [] : [v('div', { class: 'row-details' }, [
          v('div', { class: 'def-section' }, [
            v('div', { class: 'def-eyebrow' }, ['EVENT']),
            v('dl', { class: 'def-grid' }, [v('div', { class: 'def-item' }, [
              v('dt', {}, ['type']),
              v('dd', {}, [entry.slug]),
            ])]),
          ]),
        ])]),
      ]);
    }),
  ])));
}

// ---------------------------------------------------------------------------
// §4.12 Teaching states: empty / error / loading.
// ---------------------------------------------------------------------------

/** The empty state's props (exactly ONE primary action — the law). */
export interface EmptyStateProps {
  readonly icon: ComponentIcon;
  /** The short title (e.g. "No experiments yet"). */
  readonly title: string;
  /** ONE plain reassuring sentence. */
  readonly sentence: string;
  /** The single primary action: its label + its navigation target (a shell target). */
  readonly action: { readonly label: string; readonly target: string };
}

/** The EmptyState (§4.12): dashed hairline, centered icon circle, title + ONE sentence + ONE primary action. */
export function emptyState(props: EmptyStateProps): VNode {
  return v('div', { class: 'empty-state', 'data-empty': props.title }, [
    v('div', { class: 'empty-circle', 'aria-hidden': 'true' }, [iconOf(props.icon, 'ci ci-20')]),
    v('div', { class: 'empty-title' }, [props.title]),
    v('p', { class: 'empty-sentence' }, [props.sentence]),
    v('button', { class: 'empty-action', 'data-target': props.action.target, type: 'button' }, [props.action.label]),
  ]);
}

/** The ErrorState (§4.12): role=alert, soft rose circle, ONE sentence, ONE "Try again" pill; raw error text ONLY in the expandable mono block. */
export function errorState(sentence: string, options: { readonly technical?: string; readonly retryAction?: string } = {}): VNode {
  return v('div', { class: 'error-state', role: 'alert' }, [
    v('div', { class: 'error-circle', 'aria-hidden': 'true' }, [iconOf('alert', 'ci ci-20')]),
    v('p', { class: 'error-sentence' }, [sentence]),
    v('button', { class: 'error-retry', 'data-action': options.retryAction ?? 'refresh', type: 'button' }, ['Try again']),
    ...(options.technical === undefined ? [] : [v('details', { class: 'error-technical' }, [
      v('summary', {}, ['Technical details']),
      v('pre', { class: 'error-technical-body' }, [options.technical]),
    ])]),
  ]);
}

/** The LoadingState (§4.12): layout-mirroring skeletons — never a spinner. */
export function loadingState(mirror: 'stat-grid' | 'rows' | 'timeline', rows = 3): VNode {
  const count = mirror === 'stat-grid' ? 4 : rows;
  const skeleton = (extraClass: string): VNode => v('div', { class: `skeleton ${extraClass}`, 'aria-hidden': 'true' }, []);
  if (mirror === 'stat-grid') {
    return v('div', { class: 'stat-grid loading', 'data-loading': 'stat-grid', role: 'status' }, [
      v('div', { class: 'stat-card' }, [skeleton('sk-label'), skeleton('sk-value')]),
      v('div', { class: 'stat-card' }, [skeleton('sk-label'), skeleton('sk-value')]),
      v('div', { class: 'stat-card' }, [skeleton('sk-label'), skeleton('sk-value')]),
      v('div', { class: 'stat-card' }, [skeleton('sk-label'), skeleton('sk-value')]),
    ]);
  }
  if (mirror === 'rows') {
    return v('div', { class: 'rows loading', 'data-loading': 'rows', role: 'status' },
      Array.from({ length: count }, () => v('div', { class: 'list-row skeleton-row' }, [skeleton('sk-tile'), skeleton('sk-lines')])));
  }
  return v('div', { class: 'timeline loading', 'data-loading': 'timeline', role: 'status' },
    Array.from({ length: count }, () => v('div', { class: 'timeline-row skeleton-row' }, [skeleton('sk-tile'), skeleton('sk-lines')])));
}
