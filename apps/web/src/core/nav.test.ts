// Tests for the shell navigation (core/nav.ts — UX-DESIGN.md §2/§3, T051).
//
// Laws pinned here:
//   - the four charter groups, in charter order, with their exact
//     labels (Overview / Workspace / Evidence / Account);
//   - ALL FIFTEEN targets, in navigation order (D1: one-click
//     reachability — the complete list is the law);
//   - the twelve workspace sections keep UX.md's own order inside the
//     Workspace and Evidence groups;
//   - every target carries a title and a §3 one-sentence subtitle.

import { describe, expect, it } from 'vitest';
import { WORKSPACE_SECTIONS } from './sections';
import { isSectionTarget, isShellTarget, NAV_GROUPS, SHELL_SUBTITLES, SHELL_TARGETS, SHELL_TITLES } from './nav';

describe('nav: the four charter groups, in order', () => {
  it('the groups are Overview, Workspace, Evidence, Account — in charter order', () => {
    expect(NAV_GROUPS.map((group) => group.label)).toEqual(['Overview', 'Workspace', 'Evidence', 'Account']);
  });

  it('the Workspace group carries UX.md\'s nine non-evidence sections in UX.md order', () => {
    const workspace = NAV_GROUPS.find((group) => group.label === 'Workspace');
    expect(workspace?.targets).toEqual([
      'goal', 'organization', 'market-world', 'time-machine', 'research', 'experiments', 'decisions', 'execution', 'risk',
    ]);
  });

  it('the Evidence group is Evidence, Outcomes, Lessons; Account is Inbox, Settings; Overview is Home', () => {
    expect(NAV_GROUPS.find((group) => group.label === 'Overview')?.targets).toEqual(['home']);
    expect(NAV_GROUPS.find((group) => group.label === 'Evidence')?.targets).toEqual(['evidence', 'outcomes', 'lessons']);
    expect(NAV_GROUPS.find((group) => group.label === 'Account')?.targets).toEqual(['inbox', 'settings']);
  });
});

describe('nav: the fifteen targets (D1 one-click reachability)', () => {
  it('all fifteen targets, in navigation order (the groups partition them — nothing repeats)', () => {
    expect(SHELL_TARGETS).toEqual([
      'home',
      ...WORKSPACE_SECTIONS,
      'inbox',
      'settings',
    ]);
    expect(SHELL_TARGETS.length).toBe(15);
  });

  it('every target is unique', () => {
    expect(new Set(SHELL_TARGETS).size).toBe(SHELL_TARGETS.length);
  });

  it('the target guards accept exactly the fifteen targets', () => {
    for (const target of SHELL_TARGETS) expect(isShellTarget(target)).toBe(true);
    expect(isShellTarget('home')).toBe(true);
    expect(isShellTarget('dashboard')).toBe(false);
    expect(isShellTarget('')).toBe(false);
    expect(isShellTarget(null)).toBe(false);
    expect(isSectionTarget('goal')).toBe(true);
    expect(isSectionTarget('home')).toBe(false);
    expect(isSectionTarget('inbox')).toBe(false);
  });
});

describe('nav: titles and §3 subtitles (the scaffold copy)', () => {
  it('every target has a title', () => {
    for (const target of SHELL_TARGETS) {
      expect(SHELL_TITLES[target].length, target).toBeGreaterThan(0);
    }
    expect(SHELL_TITLES.home).toBe('Home');
    expect(SHELL_TITLES.inbox).toBe('Inbox');
    expect(SHELL_TITLES.settings).toBe('Settings');
    expect(SHELL_TITLES['market-world']).toBe('Market World');
  });

  it('every target carries its charter §3 subtitle, one sentence each', () => {
    for (const target of SHELL_TARGETS) {
      const subtitle = SHELL_SUBTITLES[target];
      expect(subtitle, target).toBeTruthy();
      // one sentence: ends with a period, no internal sentence breaks
      expect(subtitle.endsWith('.'), target).toBe(true);
      expect(subtitle.split('.').length, target).toBe(2);
    }
    // the charter's own wording (the shape is law; spot-check the list)
    expect(SHELL_SUBTITLES.home).toBe('Your organization at a glance.');
    expect(SHELL_SUBTITLES.goal).toBe('Describe what this organization should achieve.');
    expect(SHELL_SUBTITLES['time-machine']).toBe('Revisit any instant, exactly as it was known then.');
    expect(SHELL_SUBTITLES.evidence).toBe('Content-addressed evidence capsules.');
    expect(SHELL_SUBTITLES.inbox).toBe('Notifications from your organization.');
    expect(SHELL_SUBTITLES.settings).toBe('Configure the console and its connection.');
  });
});
