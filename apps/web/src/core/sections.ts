// @tradrl/web-console — the twelve workspace sections (UX.md, verbatim).
//
// THE LAW (Work Order T042): "The workspace model: the twelve UX.md
// sections (Goal, Organization, Market World, Time Machine,
// Research, Experiments, Decisions, Execution, Risk, Evidence,
// Outcomes, Lessons) as a typed project workspace state". The
// section list is UX.md's own order — the vocabulary is law, not
// configuration; adding or renaming a section is a UX charter
// change, never a console whim.

/** The twelve UX.md sections, in charter order. */
export const WORKSPACE_SECTIONS = [
  'goal',
  'organization',
  'market-world',
  'time-machine',
  'research',
  'experiments',
  'decisions',
  'execution',
  'risk',
  'evidence',
  'outcomes',
  'lessons',
] as const;

/** One workspace section id. */
export type SectionId = (typeof WORKSPACE_SECTIONS)[number];

/** Guard: a workspace section id. */
export function isSectionId(v: unknown): v is SectionId {
  return typeof v === 'string' && (WORKSPACE_SECTIONS as readonly string[]).includes(v);
}

/** The human title of a section (closed vocabulary — the UX charter's own names). */
export const SECTION_TITLES: Readonly<Record<SectionId, string>> = Object.freeze({
  'goal': 'Goal',
  'organization': 'Organization',
  'market-world': 'Market World',
  'time-machine': 'Time Machine',
  'research': 'Research',
  'experiments': 'Experiments',
  'decisions': 'Decisions',
  'execution': 'Execution',
  'risk': 'Risk',
  'evidence': 'Evidence',
  'outcomes': 'Outcomes',
  'lessons': 'Lessons',
});

/** The one-line charter of each section (what it renders — UX.md's project workspace). */
export const SECTION_CHARTERS: Readonly<Record<SectionId, string>> = Object.freeze({
  'goal': 'The objective, horizon, success criteria and evaluation discipline.',
  'organization': 'The compiled agent organization and its operating status.',
  'market-world': 'The markets, venues and data the project trades on.',
  'time-machine': 'T-x, explicit timestamp and controlled playback over point-in-time truth.',
  'research': 'The research questions and their async jobs.',
  'experiments': 'The experiment and trial lineage behind every result.',
  'decisions': 'The proposals, challenges, risk checks and decisions.',
  'execution': 'Execution requests and the gateway\'s verdicts (the console requests; the gateway decides).',
  'risk': 'The constraint set, risk policies and hard refusals.',
  'evidence': 'The content-addressed evidence capsules.',
  'outcomes': 'The realized outcomes and their deviations.',
  'lessons': 'The firm knowledge and post-mortems the project learned.',
});

/** The default section of a fresh workspace. */
export const DEFAULT_SECTION: SectionId = 'goal';
