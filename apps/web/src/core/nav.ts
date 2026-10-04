// @tradrl/web-console — the shell navigation (UX-DESIGN.md §2, T051).
//
// THE CHARTER (§2 "Navigation"): grouped, in order —
//   Overview: Home
//   Workspace: Goal, Organization, Market World, Time Machine,
//     Research, Experiments, Decisions, Execution, Risk
//   Evidence: Evidence, Outcomes, Lessons
//   Account: Inbox, Settings
// …and (§3) every section gets its one-sentence muted subtitle from
// the charter's own list. The group order, the fifteen targets and
// the subtitle shape are LAW (the discoverability law D1: every
// section is reachable in exactly one click from any section).
//
// The twelve workspace sections are UX.md's own vocabulary
// (core/sections.ts — unchanged law); the shell adds three targets
// around them: Home (the overview landing), Inbox (notifications)
// and Settings (the console's configuration).

import { SECTION_TITLES, WORKSPACE_SECTIONS, type SectionId } from './sections';

/** One navigation group: a charter label + its targets, in charter order. */
export interface NavGroup {
  readonly label: string;
  readonly targets: readonly ShellTarget[];
}

/** A shell navigation target: Home, one of the twelve workspace sections, Inbox, or Settings. */
export type ShellTarget = 'home' | SectionId | 'inbox' | 'settings';

/**
 * The Workspace group's nine sections: UX.md's order with the three
 * evidence sections lifted into the Evidence group (charter §2 — the
 * groups partition the fifteen targets; nothing repeats).
 */
const WORKSPACE_GROUP: readonly SectionId[] = Object.freeze(WORKSPACE_SECTIONS.filter(
  (section) => section !== 'evidence' && section !== 'outcomes' && section !== 'lessons',
));

/** The four charter groups, in charter order (§2). */
export const NAV_GROUPS: readonly NavGroup[] = Object.freeze([
  { label: 'Overview', targets: Object.freeze(['home'] as const) },
  { label: 'Workspace', targets: WORKSPACE_GROUP },
  { label: 'Evidence', targets: Object.freeze(['evidence', 'outcomes', 'lessons'] as const) },
  { label: 'Account', targets: Object.freeze(['inbox', 'settings'] as const) },
]);

/** All fifteen targets, in navigation order (charter §2's complete list). */
export const SHELL_TARGETS: readonly ShellTarget[] = Object.freeze(NAV_GROUPS.flatMap((group) => [...group.targets]));

/** Guard: a shell navigation target. */
export function isShellTarget(value: unknown): value is ShellTarget {
  return typeof value === 'string' && (SHELL_TARGETS as readonly string[]).includes(value);
}

/** Guard: one of the twelve workspace sections (a target with a workspace panel). */
export function isSectionTarget(value: ShellTarget): value is SectionId {
  return (WORKSPACE_SECTIONS as readonly string[]).includes(value);
}

/** The human title of every target (the sections keep UX.md's own names). */
export const SHELL_TITLES: Readonly<Record<ShellTarget, string>> = Object.freeze({
  home: 'Home',
  ...SECTION_TITLES,
  inbox: 'Inbox',
  settings: 'Settings',
});

/** The charter §3 subtitles — one sentence each, the charter's own wording (the shape is law). */
export const SHELL_SUBTITLES: Readonly<Record<ShellTarget, string>> = Object.freeze({
  home: 'Your organization at a glance.',
  goal: 'Describe what this organization should achieve.',
  organization: 'The compiled team working your goal.',
  'market-world': 'The world your organization trades in.',
  'time-machine': 'Revisit any instant, exactly as it was known then.',
  research: 'Evidence-gathering work by your research bodies.',
  experiments: 'Evaluations your organization has run.',
  decisions: 'Every proposal, challenge, and decision.',
  execution: 'Orders and their lifecycle.',
  risk: 'Risk checks, limits, and interventions.',
  evidence: 'Content-addressed evidence capsules.',
  outcomes: 'Results and post-mortems.',
  lessons: 'What the firm has learned.',
  inbox: 'Notifications from your organization.',
  settings: 'Configure the console and its connection.',
});
