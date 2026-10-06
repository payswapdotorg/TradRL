// Tests for the command palette + the onboarding wizard (core/palette.ts,
// core/onboarding.ts — UX-DESIGN §4.13/§4.14 + §5 D4/D5, T051).
//
// Laws pinned here:
//   §4.14/D4 the palette covers 100% of the fifteen navigation targets
//            PLUS projects, jobs, notifications and evidence; the
//            fuzzy rank is deterministic; the overlay renders grouped
//            results with type badges + the keyboard affordances; the
//            sidebar carries the visible "Search ⌘K" affordance.
//   §4.13/D5 the wizard is EXACTLY three steps with the charter's
//            verbatim copy; the machine 1→3, the skip path from every
//            step, persistence (localStorage tradrl_onboarded), the
//            aria "Step N of 3", the progress dots, and returning
//            users skipping straight past it.

import { describe, expect, it } from 'vitest';
import type { EvidenceCapsule } from './evidence';
import { capsuleFromOutcome } from './evidence';
import { openWorkspace, reduceAll, type WorkspaceState } from './workspace';
import {
  advanceOnboarding,
  initialOnboarding,
  isOnboarded,
  ONBOARDING_STEPS,
  ONBOARDING_STORAGE_KEY,
  ONBOARDING_STORED_VALUE,
  onboardingDots,
  onboardingPanel,
  persistOnboarding,
  readStoredOnboarding,
  skipOnboarding,
} from './onboarding';
import {
  capsuleRefOf,
  fuzzyScore,
  paletteAffordance,
  paletteIndex,
  paletteOverlay,
  projectRefOf,
  rankPalette,
  type PaletteEntry,
} from './palette';
import { serializeVNode } from '../render/vtree';

const SCOPE = { tenantId: 'tenant-a', projectId: 'proj-a' } as const;
const T0 = 1_700_000_000_000;

const render = (node: unknown): string => serializeVNode(node as import('../render/vtree').VNode);

function capsule(): EvidenceCapsule {
  const outcome = {
    outcomeId: 'out-1', ordinal: 1, tenant: 'tenant-a', project: 'proj-a',
    decision: { decisionRef: 'dec-1', intentRef: 'int-1', disposition: 'filled' },
    outcomeClass: 'realized-profit',
    expectation: { expectedQuantity: '10', expectedRealized: '1.5', tolerance: '0.25', declaredBy: 'b1' },
    realization: { filledQuantity: '10', realizedOutcome: '1.75', feeTotal: '0.02', notionalTotal: '1000.00', unrealizedAtDecision: '0.00' },
    deviation: { quantityShortfall: null, realizedGap: '0.25', withinTolerance: true },
    evidence: [{ kind: 'fill', ref: 'fil-1' }],
    lineage: { shadow: { fidelity: { mode: 'shadow' }, riskPolicy: { policyId: 'pol-1', version: 2 }, experiment: null } },
    asOf: T0 + 30, priorChainHead: '00000000',
  } as never;
  return capsuleFromOutcome(SCOPE, outcome);
}

/** A populated workspace: a project, a job, two notices, evidence capsules. */
function populatedWorkspace(): WorkspaceState {
  const project = {
    id: 'proj-a', tenantId: 'tenant-a', name: 'Console Test Project', executionMode: 'simulation',
    lifecycle: { projectId: 'proj-a', status: 'active', acceptanceCriteriaId: null, organizationRef: 'org:alpha' },
    lineage: { projectId: 'proj-a', createdAt: T0, createdBy: 'worker', priorVersion: null, version: 1, goal: { goalId: 'goal-1', version: 1 }, constraintSet: { id: 'cs-1', version: 1 } },
    createdAt: T0, updatedAt: T0,
  };
  const job = { jobId: 'job-1', kind: 'research', tenant: 'tenant-a', project: 'proj-a', status: 'running', submittedAt: T0 + 20 };
  const outcome = {
    outcomeId: 'out-1', ordinal: 1, tenant: 'tenant-a', project: 'proj-a',
    decision: { decisionRef: 'dec-1', intentRef: 'int-1', disposition: 'filled' },
    outcomeClass: 'realized-profit',
    expectation: { expectedQuantity: '10', expectedRealized: '1.5', tolerance: '0.25', declaredBy: 'b1' },
    realization: { filledQuantity: '10', realizedOutcome: '1.75', feeTotal: '0.02', notionalTotal: '1000.00', unrealizedAtDecision: '0.00' },
    deviation: { quantityShortfall: null, realizedGap: '0.25', withinTolerance: true },
    evidence: [{ kind: 'fill', ref: 'fil-1' }],
    lineage: { shadow: { fidelity: { mode: 'shadow' }, riskPolicy: { policyId: 'pol-1', version: 2 }, experiment: null } },
    asOf: T0 + 30, priorChainHead: '00000000',
  };
  return reduceAll(openWorkspace(SCOPE, T0), [
    { kind: 'connection-changed', at: T0 + 1, status: 'connected' },
    { kind: 'project-loaded', at: T0 + 2, project: project as never },
    { kind: 'job-updated', at: T0 + 20, job: job as never },
    { kind: 'outcomes-loaded', at: T0 + 30, records: [outcome as never] },
  ]);
}

const capsulesOf = (): readonly EvidenceCapsule[] => [capsule()];

describe('palette: D4 — 100% coverage of navigation + the other entity kinds', () => {
  it('covers ALL FIFTEEN navigation targets (the charter\'s hard requirement)', () => {
    const index = paletteIndex(openWorkspace(SCOPE, T0), capsulesOf);
    const nav = index.filter((entry) => entry.kind === 'NAVIGATION');
    expect(nav.length).toBe(15);
    expect(nav.map((entry) => entry.ref)).toEqual([
      'nav:home', 'nav:goal', 'nav:organization', 'nav:market-world', 'nav:time-machine',
      'nav:research', 'nav:experiments', 'nav:decisions', 'nav:execution', 'nav:risk',
      'nav:evidence', 'nav:outcomes', 'nav:lessons', 'nav:inbox', 'nav:settings',
    ]);
    for (const entry of nav) expect(entry.target).not.toBeNull();
  });

  it('covers projects, jobs, notifications and evidence', () => {
    const state = populatedWorkspace();
    const index = paletteIndex(state, capsulesOf);
    expect(index.some((entry) => entry.kind === 'PROJECT' && entry.title === 'Console Test Project')).toBe(true);
    expect(index.some((entry) => entry.kind === 'JOB' && entry.ref === 'job:job-1')).toBe(true);
    expect(index.some((entry) => entry.kind === 'EVIDENCE' && entry.ref.startsWith('capsule:'))).toBe(true);
    // the notice fold derives notices from the reads; the index carries whatever the inbox holds
    const noticeCount = state.inbox.notices.length;
    expect(index.filter((entry) => entry.kind === 'NOTIFICATION').length).toBe(noticeCount);
  });
});

describe('palette: the fuzzy rank (deterministic, grouped)', () => {
  it('subsequence matching: hits score, misses are -1, tight runs + prefixes score higher', () => {
    expect(fuzzyScore('evidence outcomes lessons'.replace(' outcomes lessons', ''), 'ev')).toBeGreaterThan(0);
    expect(fuzzyScore('market world', 'mw')).toBeGreaterThan(0);
    expect(fuzzyScore('market world', 'xyz')).toBe(-1);
    expect(fuzzyScore('market world', 'zzz')).toBe(-1);             // not a subsequence
    expect(fuzzyScore('experiments', 'ex')).toBeGreaterThan(0);  // prefix-ish run scores high
    expect(fuzzyScore('experiments', 'expe')).toBeGreaterThan(fuzzyScore('experiments', 'ees')); // a tight prefix run beats a scattered one
  });

  it('an empty query returns everything, grouped in the charter\'s kind order', () => {
    const index = paletteIndex(populatedWorkspace(), capsulesOf);
    const ranked = rankPalette(index, '');
    expect(ranked.length).toBe(index.length);
    const kinds = [...new Set(ranked.map((entry) => entry.kind))];
    expect(kinds).toEqual(['NAVIGATION', 'PROJECT', 'JOB', 'EVIDENCE']); // the fixture's fold yields no notices
  });

  it('a query filters and keeps best-first order inside a group (DETERMINISM)', () => {
    const index = paletteIndex(populatedWorkspace(), capsulesOf);
    const a = rankPalette(index, 'res');
    const b = rankPalette(index, 'res');
    expect(a.map((entry) => entry.ref)).toEqual(b.map((entry) => entry.ref));
    expect(a.length).toBeGreaterThan(0);
    expect(a.every((entry) => entry.haystack.includes('r') && entry.haystack.includes('e') && entry.haystack.includes('s'))).toBe(true);
    // the tie-break keeps the index order (stable)
    expect(rankPalette(index, '')).toEqual(rankPalette(index, ''));
  });

  it('queries resolve their navigation targets (case-insensitive)', () => {
    const index = paletteIndex(populatedWorkspace(), capsulesOf);
    expect(rankPalette(index, 'time').some((entry) => entry.ref === 'nav:time-machine')).toBe(true);
    expect(rankPalette(index, 'TIME').some((entry) => entry.ref === 'nav:time-machine')).toBe(true);
    expect(rankPalette(index, 'settings').some((entry) => entry.ref === 'nav:settings')).toBe(true);
    expect(rankPalette(index, 'zzzz').length).toBe(0);
  });
});

describe('palette: the overlay + the affordance (§4.14)', () => {
  it('renders the input, grouped results with type badges, aria-selected and the keyboard footer', () => {
    const results: PaletteEntry[] = [
      { kind: 'NAVIGATION', title: 'Home', subtitle: 'Overview', target: 'home', ref: 'nav:home', haystack: 'home overview' },
      { kind: 'JOB', title: 'job-1', subtitle: 'research · running', target: 'research', ref: 'job:job-1', haystack: 'job-1' },
      { kind: 'NOTIFICATION', title: 'Failed evaluation', subtitle: 'Failed evaluation', target: 'inbox', ref: 'notice:ntc-1', haystack: 'failed evaluation' },
    ];
    const bytes = render(paletteOverlay({ query: '', results, selected: 0, unread: 2 }));
    expect(bytes).toContain('class="palette"');
    expect(bytes).toContain('role="dialog"');
    expect(bytes).toContain('aria-modal="true"');
    expect(bytes).toContain('data-palette-input="true"');
    expect(bytes).toContain('class="palette-badge palette-badge-navigation"');
    expect(bytes).toContain('class="palette-badge palette-badge-job"');
    expect(bytes).toContain('aria-selected="true"');
    expect(bytes).toContain('data-target="home"');
    expect(bytes).toContain('↑ ↓ navigate');
    expect(bytes).toContain('Enter open');
    expect(bytes).toContain('Esc close');
    expect(bytes).toContain('2 unread');
  });

  it('the sidebar carries the visible "Search ⌘K" affordance', () => {
    const bytes = render(paletteAffordance());
    expect(bytes).toContain('data-action="palette-open"');
    expect(bytes).toContain('Search');
    expect(bytes).toContain('⌘K');
  });

  it('a no-match query renders the §4.12 teaching shape inside the dialog — NEVER a blank region (D3): the icon circle, the title, ONE sentence, exactly ONE Clear search action', () => {
    const bytes = render(paletteOverlay({ query: 'zzzz', results: [], selected: 0, unread: 0 }));
    expect(bytes).toContain('class="palette-empty"');
    expect(bytes).toContain('role="status"');
    expect(bytes).toContain('class="empty-circle"'); // the icon
    expect(bytes).toContain('class="empty-title"');
    expect(bytes).toContain('No matches');
    expect(bytes).toContain('class="empty-sentence"');
    expect(bytes).toContain('zzzz'); // the sentence names the query
    expect(bytes).toContain('data-action="palette-clear"'); // the ONE action
    expect(bytes).toContain('Clear search');
    expect(bytes).not.toContain('palette-item'); // no stale rows beside the empty state
  });

  it('the overlay\'s input carries the live query as its value (the re-projected tree keeps the typed text — the W-14c query wiring)', () => {
    const index = paletteIndex(populatedWorkspace(), capsulesOf);
    const ranked = rankPalette(index, 'settings');
    expect(ranked.some((entry) => entry.ref === 'nav:settings')).toBe(true);
    const bytes = render(paletteOverlay({ query: 'settings', results: ranked, selected: 0, unread: 0 }));
    expect(bytes).toContain('value="settings"'); // the input's value is the query
    expect(bytes).toContain('data-palette-ref="nav:settings"'); // the ranked result renders
  });
});

describe('onboarding: §4.13 — the three steps (charter copy, verbatim)', () => {
  it('EXACTLY three steps with the charter\'s eyebrows, titles, sentences and CTAs', () => {
    expect(ONBOARDING_STEPS.length).toBe(3);
    expect(ONBOARDING_STEPS[0]).toEqual({
      eyebrow: 'Welcome',
      title: 'Welcome to TradRL',
      sentence: 'Run a trading research organization: set a goal, watch it work, and audit every decision.',
      cta: 'Continue',
    });
    expect(ONBOARDING_STEPS[1]).toEqual({
      eyebrow: 'How it works',
      title: 'How it works',
      sentence: 'Your organization researches, proposes, and executes under hard risk gates — with evidence attached to every step.',
      cta: 'Continue',
    });
    expect(ONBOARDING_STEPS[2]).toEqual({
      eyebrow: "You're ready",
      title: "You're ready",
      sentence: 'Start by describing a goal; the console compiles an organization and you watch it work.',
      cta: 'Get started',
    });
  });
});

describe('onboarding: the machine + persistence (D5)', () => {
  it('advances 1 -> 2 -> 3 -> completed (never a fourth step)', () => {
    let state = initialOnboarding();
    expect(state).toEqual({ step: 0 });
    state = advanceOnboarding(state);
    expect(state).toEqual({ step: 1 });
    state = advanceOnboarding(state);
    expect(state).toEqual({ step: 2 });
    state = advanceOnboarding(state);
    expect(isOnboarded(state)).toBe(true);
    expect(advanceOnboarding(state)).toBe(state); // terminal
  });

  it('skip completes from EVERY step; completion persists under tradrl_onboarded', () => {
    for (const step of [0, 1, 2]) {
      let state = initialOnboarding();
      for (let index = 0; index < step; index += 1) state = advanceOnboarding(state);
      expect(skipOnboarding(state)).toEqual({ completed: true });
    }
    expect(ONBOARDING_STORAGE_KEY).toBe('tradrl_onboarded');
  });

  it('the storage round-trip: a returning user skips straight past; a foreign value means not onboarded', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null), setItem: (key: string, value: string) => { store.set(key, value); } };
    expect(readStoredOnboarding(storage)).toEqual({ step: 0 }); // fresh: the wizard shows
    persistOnboarding(storage);
    expect(store.get('tradrl_onboarded')).toBe(ONBOARDING_STORED_VALUE);
    expect(readStoredOnboarding(storage)).toEqual({ completed: true }); // returning: skip straight past
    store.set('tradrl_onboarded', 'garbage');
    expect(readStoredOnboarding(storage)).toEqual({ step: 0 });
    const exploding = { getItem: (): string => { throw new Error('no storage'); }, setItem: (): void => { throw new Error('no storage'); } };
    expect(readStoredOnboarding(exploding)).toEqual({ step: 0 });
    expect(() => persistOnboarding(exploding)).not.toThrow();
  });
});

describe('onboarding: the panel chrome (§4.13)', () => {
  it('renders the glyph circle, eyebrow, H1, sentence, CTA + arrow, Skip and the aria step readout', () => {
    const bytes = render(onboardingPanel(initialOnboarding()));
    expect(bytes).toContain('data-onboarding="step-1"');
    expect(bytes).toContain('onboarding-circle');
    expect(bytes).toContain('<div class="onboarding-eyebrow">Welcome</div>');
    expect(bytes).toContain('<h1 class="onboarding-title">Welcome to TradRL</h1>');
    expect(bytes).toContain('audit every decision');
    expect(bytes).toContain('data-action="onboarding-next"');
    expect(bytes).toContain('Continue');
    expect(bytes).toContain('data-action="onboarding-skip"');
    expect(bytes).toContain('Skip');
    expect(bytes).toContain('aria-label="Step 1 of 3"');
    expect(bytes).toContain('onboarding-arrow');
  });

  it('the progress dots: active 24x6 pill, done + inactive 6px dots (aria on the container)', () => {
    const bytes = render(onboardingDots(1));
    expect(bytes).toContain('aria-label="Step 2 of 3"');
    expect(bytes.match(/class="onboarding-dot"/g)?.length).toBe(1);       // inactive
    expect(bytes.match(/class="onboarding-dot done"/g)?.length).toBe(1);  // before the active
    expect(bytes.match(/class="onboarding-dot active"/g)?.length).toBe(1);
  });

  it('the completed state renders the hidden marker (never blocks)', () => {
    const bytes = render(onboardingPanel(skipOnboarding(initialOnboarding())));
    expect(bytes).toContain('data-onboarding="completed"');
  });
});

// ---------------------------------------------------------------------------
// D-16 (W-29 wave 2) — THE PALETTE DEPTH: the cross-project jump entries,
// the substitution-tolerant matcher, and the entity-open grammar (the
// project/capsule ref parsers the app layer's Enter + click ride).
// ---------------------------------------------------------------------------

describe('palette: D-16 — the cross-project jump entries', () => {
  /** A workspace scoped to proj-a with a THREE-desk directory (the current desk + two others). */
  function multiDeskWorkspace(): WorkspaceState {
    const project = (id: string, name: string) => ({
      id, tenantId: 'tenant-a', name, executionMode: 'simulation',
      lifecycle: { projectId: id, status: 'active', acceptanceCriteriaId: null, organizationRef: null },
      lineage: { projectId: id, createdAt: T0, createdBy: 'worker', priorVersion: null, version: 1, goal: { goalId: 'goal-1', version: 1 }, constraintSet: { id: 'cs-1', version: 1 } },
      createdAt: T0, updatedAt: T0,
    });
    const base = populatedWorkspace(); // scoped to proj-a with its project loaded
    return reduceAll(base, [
      { kind: 'projects-listed', at: T0 + 40, records: [project('proj-a', 'Console Test Project') as never, project('prj-meridian', 'Meridian Micro Fund') as never, project('prj-other', 'The Other Project') as never] },
    ]);
  }

  it('every OTHER desk in the tenant directory is searchable — the current project is never duplicated', () => {
    const index = paletteIndex(multiDeskWorkspace(), capsulesOf);
    const projects = index.filter((entry) => entry.kind === 'PROJECT');
    expect(projects.map((entry) => entry.ref)).toEqual(['project:proj-a', 'project:prj-meridian', 'project:prj-other']); // the current desk ONCE + one jump entry per other desk
    const jump = projects.find((entry) => entry.ref === 'project:prj-meridian');
    expect(jump?.title).toBe('Meridian Micro Fund');
    expect(jump?.subtitle).toBe('switch desk · prj-meridian'); // the subtitle states what selecting it does
    expect(jump?.target).toBe('goal'); // it lands on the adopted desk's own surface
  });

  it('a project-NAME query reaches the other desks — the jump entries rank by name and id', () => {
    const ranked = rankPalette(paletteIndex(multiDeskWorkspace(), capsulesOf), 'meridian');
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0]?.ref).toBe('project:prj-meridian'); // the name query finds the other desk FIRST
    const byIdFragment = rankPalette(paletteIndex(multiDeskWorkspace(), capsulesOf), 'prj-other');
    expect(byIdFragment.some((entry) => entry.ref === 'project:prj-other')).toBe(true); // the id fragment works too
  });

  it('an empty directory adds nothing (the pre-D-16 index shape holds)', () => {
    const index = paletteIndex(populatedWorkspace(), capsulesOf);
    expect(index.filter((entry) => entry.kind === 'PROJECT').map((entry) => entry.ref)).toEqual(['project:proj-a']);
  });
});

describe('palette: D-16 — the substitution-tolerant matcher (the personas\' own typos)', () => {
  it('substitution typos match: "evdance" and "rezearch" score where the subsequence pass alone returned -1', () => {
    expect(fuzzyScore('evidence evidence', 'evidnce')).toBeGreaterThan(0); // deletion — the subsequence pass (unchanged behavior)
    expect(fuzzyScore('evidence evidence', 'evdance')).toBeGreaterThan(0); // substitution — the corrected pass (S2's own typo)
    expect(fuzzyScore('research workspace', 'rezearch')).toBeGreaterThan(0); // S4's own typo
  });

  it('the sane rank: a genuine subsequence match outranks a corrected one for the same target', () => {
    // 'evidnce' (deletion) hits the subsequence pass with a strong prefix run;
    // 'evdance' (substitution) falls to the corrected pass — the deletion-tolerant
    // match must rank ABOVE the corrected one, never below.
    expect(fuzzyScore('evidence evidence', 'evidnce')).toBeGreaterThan(fuzzyScore('evidence evidence', 'evdance'));
    // and both rank below the exact prefix match
    expect(fuzzyScore('evidence evidence', 'ev')).toBeGreaterThan(fuzzyScore('evidence evidence', 'evdance'));
  });

  it('the correction stays bounded: garbage still matches nothing, and short queries are never corrected', () => {
    expect(fuzzyScore('market world', 'xyz')).toBe(-1); // the pinned miss holds
    expect(fuzzyScore('market world', 'zzzz')).toBe(-1); // distance 6 against a 2 allowance — rejected
    expect(fuzzyScore('decisions every proposal challenge and decision', 'zzzzzzzz')).toBe(-1);
    expect(fuzzyScore('evidence evidence', 'zz')).toBe(-1); // a 2-character query is too short to correct (it would match almost anything) and matches nothing as a subsequence
    expect(fuzzyScore('research workspace', 'research!!!')).toBe(-1); // 3 substitutions sit beyond the bounded allowance
  });

  it('rankPalette end to end: the typo query finds the section (the pre-fix behavior was the teaching no-match state)', () => {
    const ranked = rankPalette(paletteIndex(populatedWorkspace(), capsulesOf), 'evdance');
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked.some((entry) => entry.ref === 'nav:evidence')).toBe(true); // S2's typo now reaches Evidence
    const research = rankPalette(paletteIndex(populatedWorkspace(), capsulesOf), 'rezearch');
    expect(research.some((entry) => entry.ref === 'nav:research')).toBe(true); // S4's typo now reaches Research
  });
});

describe('palette: D-16 — the entity-open grammar (project + capsule ref parsers)', () => {
  it('projectRefOf parses project refs and rejects every other grammar', () => {
    expect(projectRefOf('project:prj-meridian')).toBe('prj-meridian');
    expect(projectRefOf('project:')).toBeNull();
    expect(projectRefOf('nav:home')).toBeNull();
    expect(projectRefOf('job:job-1')).toBeNull();
    expect(projectRefOf('capsule:evc:abcd1234')).toBeNull();
    expect(projectRefOf('notice:ntc-1')).toBeNull();
  });

  it('capsuleRefOf parses capsule refs into the §4.9 open key and rejects every other grammar', () => {
    expect(capsuleRefOf('capsule:evc:abcd1234')).toBe('evc:abcd1234');
    expect(capsuleRefOf('capsule:')).toBeNull();
    expect(capsuleRefOf('nav:evidence')).toBeNull();
    expect(capsuleRefOf('job:job-1')).toBeNull();
    expect(capsuleRefOf('project:prj-a')).toBeNull();
  });
});
