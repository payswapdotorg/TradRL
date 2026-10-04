// Tests for the component system part 1 (render/components.ts — UX-DESIGN
// §4.1-§4.6 + §4.12, T051).
//
// Laws pinned here — every charter clause gets a pin:
//   §4.1 the KPI tile shape (icon + uppercase label + tabular semibold
//        value + optional delta; not-ok mutes) and the 2→4-col grid;
//   §4.2 the rich stat card (eyebrow, value + qualifier, ONE sentence,
//        border-top + 3-column dl);
//   §4.3 pills + dots (never color alone: the label always rides with
//        the mark; connection + domain tone mappings);
//   §4.4 the list row (full-width button, tile, pill, trailing chevron,
//        selected/disabled states);
//   §4.5 the accordion (Show/Hide details + rotating chevron + the
//        definition grid under STATUS/METRICS/IDENTITY/ADVANCED
//        eyebrows) and the right-side sheet (dialog, 28rem class,
//        backdrop, close action);
//   §4.6 the timeline rows (period headers, HH:MM, severity tints,
//        the latest-row tint, typed-slug expandable);
//   §4.12 the teaching states (EmptyState: icon circle + title + ONE
//        sentence + exactly ONE action; ErrorState: role=alert + one
//        sentence + Try again + raw text only in Technical details;
//        LoadingState: skeletons, no spinners).

import { describe, expect, it } from 'vitest';
import {
  accordionRow,
  detailSheet,
  definitionGrid,
  emptyState,
  errorState,
  iconOf,
  listRow,
  loadingState,
  pillToneOfConnection,
  pillToneOfDomain,
  richStatCard,
  statCard,
  statGrid,
  statusDot,
  statusPill,
  timelineList,
  type DefinitionSection,
} from './components';
import { serializeVNode, type VNode } from './vtree';

const render = (node: VNode): string => serializeVNode(node);

describe('components §4.3: status pills and dots (never color alone)', () => {
  it('the connection mapping is §1.3\'s own (live/warn/down/idle)', () => {
    expect(pillToneOfConnection('live')).toBe('live');
    expect(pillToneOfConnection('warn')).toBe('warn');
    expect(pillToneOfConnection('down')).toBe('down');
    expect(pillToneOfConnection('idle')).toBe('idle');
  });

  it('the domain mapping: submitted idle, running live, complete live, failed down, blocked warn', () => {
    expect(pillToneOfDomain('submitted')).toBe('idle');
    expect(pillToneOfDomain('running')).toBe('live');
    expect(pillToneOfDomain('complete')).toBe('live');
    expect(pillToneOfDomain('failed')).toBe('down');
    expect(pillToneOfDomain('blocked')).toBe('warn');
  });

  it('a pill ALWAYS carries the mark AND the label (never color alone)', () => {
    const pill = render(statusPill('live', 'LIVE'));
    expect(pill).toContain('class="status-pill pill-live"');
    expect(pill).toContain('class="pill-mark pill-mark-live"');
    expect(pill).toContain('<span class="pill-label">LIVE</span>');
    const dot = render(statusDot('warn', 'DEGRADED', 10));
    expect(dot).toContain('pill-dot-10');
    expect(dot).toContain('<span class="pill-dot-label">DEGRADED</span>');
  });
});

describe('components §4.1: the KPI stat card', () => {
  it('renders icon + uppercase label + semibold tabular value + optional delta', () => {
    const card = render(statCard({ icon: 'pulse', label: 'ACTIVE JOBS', value: '3', delta: '+1 today' }));
    expect(card).toContain('class="stat-card"');
    expect(card).toContain('class="stat-label-row"');
    expect(card).toContain('<span class="stat-label">ACTIVE JOBS</span>');
    expect(card).toContain('<div class="stat-value">3</div>');
    expect(card).toContain('<div class="stat-delta">+1 today</div>');
    expect(card).not.toContain('stat-not-ok');
  });

  it('a not-ok value mutes (stat-not-ok); the value renders verbatim (exact decimals)', () => {
    const card = render(statCard({ icon: 'chart', label: 'REALIZED', value: '1.75', ok: false }));
    expect(card).toContain('stat-not-ok');
    expect(card).toContain('<div class="stat-value">1.75</div>');
  });

  it('the grid carries the 2→4 column class', () => {
    const grid = render(statGrid([statCard({ icon: 'box', label: 'A', value: '1' })]));
    expect(grid).toContain('class="stat-grid"');
  });
});

describe('components §4.2: the rich stat card (the PATH QUALITY pattern)', () => {
  it('renders eyebrow + value + qualifier + ONE sentence + the 3-column dl', () => {
    const card = render(richStatCard({
      eyebrow: 'PATH QUALITY',
      value: 'Good',
      qualifier: '42 ms',
      sentence: 'Order routing is healthy across every venue you trade.',
      details: [['Venues', '3'], ['Fill rate', '98.2%'], ['Rejects', '0']],
    }));
    expect(card).toContain('class="rich-stat-card"');
    expect(card).toContain('<div class="rich-eyebrow">PATH QUALITY</div>');
    expect(card).toContain('<span class="rich-value">Good</span>');
    expect(card).toContain('<span class="rich-qualifier">42 ms</span>');
    expect(card).toContain('<p class="rich-sentence">Order routing is healthy across every venue you trade.</p>');
    expect(card).toContain('<dl class="rich-dl">');
    expect(card.match(/<div class="rich-dl-item">/g)?.length).toBe(3);
    expect(card).toContain('<dt>Venues</dt><dd>3</dd>');
  });
});

describe('components §4.4: the interactive list row', () => {
  it('renders a full-width button row: tile + title + subtitle + pill + meta + chevron', () => {
    const row = render(listRow({
      icon: 'flask',
      title: 'job-1',
      subtitle: 'research',
      pill: { tone: 'live', label: 'running' },
      meta: '12:04',
      rowId: 'job:job-1',
    }));
    expect(row).toContain('<button class="list-row" data-row="job:job-1"');
    expect(row).toContain('class="row-tile"');
    expect(row).toContain('<span class="row-title">job-1</span>');
    expect(row).toContain('<span class="row-subtitle">research</span>');
    expect(row).toContain('class="status-pill pill-live row-pill"');
    expect(row).toContain('<span class="row-meta">12:04</span>');
    expect(row).toContain('row-chevron');
  });

  it('selected and disabled states ride the class; disabled sets aria-disabled', () => {
    const selected = render(listRow({ icon: 'box', title: 'a', rowId: 'x:a', selected: true }));
    expect(selected).toContain('class="list-row selected"');
    const disabled = render(listRow({ icon: 'box', title: 'a', rowId: 'x:a', disabled: true }));
    expect(disabled).toContain('class="list-row disabled"');
    expect(disabled).toContain('aria-disabled="true"');
  });
});

describe('components §4.5: detail views (the accordion + the sheet)', () => {
  const sections: readonly DefinitionSection[] = [
    { eyebrow: 'STATUS', pairs: [['state', 'running']] },
    { eyebrow: 'METRICS', pairs: [['elapsed', '4m']] },
    { eyebrow: 'IDENTITY', pairs: [['id', 'job-1']] },
    { eyebrow: 'ADVANCED', pairs: [['kind', 'research']] },
  ];

  it('the definition grid: dt/dd pairs under 0.65rem uppercase eyebrows', () => {
    const grid = definitionGrid(sections).map(serializeVNode).join('');
    expect(grid).toContain('<div class="def-eyebrow">STATUS</div>');
    expect(grid).toContain('<dl class="def-grid">');
    expect(grid).toContain('<dt>state</dt><dd>running</dd>');
    expect(grid.match(/def-eyebrow/g)?.length).toBe(4);
  });

  it('the accordion row: Show/Hide details labels + chevron + the definition grid inside', () => {
    const row = render(accordionRow({ icon: 'flask', title: 'job-1', rowId: 'job:job-1', details: sections }));
    expect(row).toContain('accordion-row');
    expect(row).toContain('<span class="when-closed">Show details</span>');
    expect(row).toContain('<span class="when-open">Hide details</span>');
    expect(row).toContain('row-chevron');
    expect(row).toContain('def-eyebrow">STATUS');
    expect(row).toContain('def-eyebrow">ADVANCED');
  });

  it('the sheet: backdrop + dialog + close action + the definition grid', () => {
    const sheet = detailSheet({ sheetId: 'job:job-1', title: 'job-1', subtitle: 'research job', details: sections });
    const bytes = sheet.map(serializeVNode).join('');
    expect(bytes).toContain('class="sheet-backdrop" data-action="sheet-close"');
    expect(bytes).toContain('role="dialog"');
    expect(bytes).toContain('aria-modal="true"');
    expect(bytes).toContain('data-sheet="job:job-1"');
    expect(bytes).toContain('aria-label="Close details"');
    expect(bytes).toContain('def-eyebrow">IDENTITY');
  });
});

describe('components §4.6: the timeline rows', () => {
  it('renders period headers, HH:MM times, severity tints, the latest-row tint and typed slugs', () => {
    const at = Date.UTC(2026, 9, 4, 9, 30);
    const list = render(timelineList([
      { label: 'TODAY', entries: [
        { at, title: 'Evaluation failed', description: 'The kickoff evaluation did not pass.', slug: 'failed_evaluation', severity: 'error' },
        { at: at - 3_600_000, title: 'Organization compiled', slug: 'organization_compiled' },
      ] },
    ]));
    expect(list).toContain('data-period="TODAY"');
    expect(list).toContain('<span class="timeline-time">09:30</span>');
    expect(list).toContain('sev-error');
    expect(list).toContain('timeline-row latest');           // the first row of the first bucket
    expect(list.match(/timeline-row latest/g)?.length).toBe(1); // exactly ONE latest tint
    expect(list).toContain('data-timeline="failed_evaluation"');
    expect(list).toContain('<dd>failed_evaluation</dd>');     // the typed slug in the expandable detail
  });
});

describe('components §4.12: the teaching states', () => {
  it('EmptyState: icon circle + title + ONE sentence + exactly ONE primary action', () => {
    const empty = render(emptyState({
      icon: 'flask',
      title: 'No experiments yet',
      sentence: 'Run your first evaluation from Research.',
      action: { label: 'Open Research', target: 'research' },
    }));
    expect(empty).toContain('class="empty-state"');
    expect(empty).toContain('empty-circle');
    expect(empty).toContain('<div class="empty-title">No experiments yet</div>');
    expect(empty).toContain('<p class="empty-sentence">Run your first evaluation from Research.</p>');
    expect(empty.match(/class="empty-action"/g)?.length).toBe(1);
    expect(empty).toContain('data-target="research"');
  });

  it('ErrorState: role=alert + ONE sentence + ONE Try again pill; raw text ONLY in Technical details', () => {
    const err = render(errorState('The console could not reach the API.', { technical: 'ECONNREFUSED 127.0.0.1:8787' }));
    expect(err).toContain('role="alert"');
    expect(err).toContain('<p class="error-sentence">The console could not reach the API.</p>');
    expect(err.match(/class="error-retry"/g)?.length).toBe(1);
    expect(err).toContain('Technical details');
    expect(err).toContain('<pre class="error-technical-body">ECONNREFUSED 127.0.0.1:8787</pre>');
    // the raw code never renders outside the mono block
    expect(err.match(/ECONNREFUSED/g)?.length).toBe(1);
  });

  it('LoadingState: layout-mirroring skeletons, never a spinner', () => {
    for (const mirror of ['stat-grid', 'rows', 'timeline'] as const) {
      const loading = render(loadingState(mirror));
      expect(loading).toContain(`data-loading="${mirror}"`);
      expect(loading).toContain('class="skeleton');
      expect(loading).toContain('role="status"');
      expect(loading).not.toContain('spinner');
      expect(loading).not.toContain('animate-spin');
    }
    expect(render(loadingState('stat-grid')).match(/class="stat-card"/g)?.length).toBe(4);
  });
});

describe('components: determinism (pure data)', () => {
  it('identical props -> identical bytes', () => {
    const props = { icon: 'flask' as const, title: 'job-1', rowId: 'job:job-1' };
    expect(render(listRow(props))).toBe(render(listRow(props)));
    expect(iconOf('check')).toStrictEqual(iconOf('check'));
  });
});
