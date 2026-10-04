// Tests for the twelve workspace sections (UX.md, verbatim).
//
// Laws pinned here (sections.ts header): "The section list is UX.md's own
// order — the vocabulary is law, not configuration; adding or renaming a
// section is a UX charter change, never a console whim." The test pins the
// exact twelve ids, their exact order, their titles, and the default section.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SECTION,
  SECTION_CHARTERS,
  SECTION_TITLES,
  WORKSPACE_SECTIONS,
  isSectionId,
} from './sections';

describe('sections: the twelve UX.md sections, in charter order', () => {
  it('is exactly the twelve, in exactly UX.md\'s order', () => {
    expect([...WORKSPACE_SECTIONS]).toEqual([
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
    ]);
  });

  it('the vocabulary is exactly twelve — no more, no fewer (a console whim cannot add or drop one)', () => {
    expect(WORKSPACE_SECTIONS).toHaveLength(12);
    expect(new Set(WORKSPACE_SECTIONS).size).toBe(12);
    // the compile-time `as const` vocabulary: spreading for mutation never touches the source list
    const copy: string[] = [...WORKSPACE_SECTIONS];
    copy.push('misc');
    expect(WORKSPACE_SECTIONS).toHaveLength(12);
    expect(copy).toHaveLength(13);
  });

  it('isSectionId admits exactly the twelve (and nothing else)', () => {
    for (const id of WORKSPACE_SECTIONS) {
      expect(isSectionId(id), id).toBe(true);
    }
    for (const bad of ['Goal', 'GOAL', 'goal ', '', 'misc', 'time_machine', 42, null, undefined]) {
      expect(isSectionId(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('sections: titles and charters', () => {
  it('every section has a non-empty human title', () => {
    for (const id of WORKSPACE_SECTIONS) {
      expect(SECTION_TITLES[id].length).toBeGreaterThan(0);
    }
    expect(SECTION_TITLES['market-world']).toBe('Market World');
    expect(SECTION_TITLES['time-machine']).toBe('Time Machine');
  });

  it('every section has a one-line charter of what it renders', () => {
    for (const id of WORKSPACE_SECTIONS) {
      expect(SECTION_CHARTERS[id].length).toBeGreaterThan(0);
    }
    expect(SECTION_CHARTERS['execution']).toContain('gateway decides');
  });

  it('the title and charter maps are frozen and cover exactly the twelve', () => {
    expect(Object.isFrozen(SECTION_TITLES)).toBe(true);
    expect(Object.isFrozen(SECTION_CHARTERS)).toBe(true);
    expect(Object.keys(SECTION_TITLES).sort()).toEqual([...WORKSPACE_SECTIONS].slice().sort());
    expect(Object.keys(SECTION_CHARTERS).sort()).toEqual([...WORKSPACE_SECTIONS].slice().sort());
  });
});

describe('sections: the default', () => {
  it('a fresh workspace opens on the Goal section', () => {
    expect(DEFAULT_SECTION).toBe('goal');
    expect(isSectionId(DEFAULT_SECTION)).toBe(true);
  });
});
