import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

import {
  DEP_GRAPH_PATH,
  GRAPH_JSON_PATH,
  WORK_ITEMS_PATH,
  loadGraph,
  parseDependencyGraph,
  parseWorkItems,
  splitRow,
  surfacesOverlap,
  validate,
  type GraphItem,
  type ProgramGraph,
} from '../../scripts/program/check.mjs';

function item(overrides: Partial<GraphItem> = {}): GraphItem {
  return {
    id: 'T001',
    title: 'Repository foundation',
    deps: [],
    write_surface: ['root'],
    status: 'blocked',
    branch: null,
    pr: null,
    merged_sha: null,
    evidence: [],
    ...overrides,
  };
}

function baseGraph(items: GraphItem[]): ProgramGraph {
  return {
    schema_version: 1,
    program: 'TradRL',
    updated_at: '2026-09-27T00:00:00Z',
    policies: { max_concurrent_work_orders: 3, allowed_statuses: ['blocked', 'ready', 'in_progress', 'in_review', 'merged'] },
    items,
  };
}

/** Build a synthetic 3-node world: A <- B <- C plus an isolated X. */
function syntheticWorld() {
  const items = [
    item({ id: 'T001', title: 'A', deps: [], write_surface: ['packages/a/'], status: 'merged', branch: 'work/a', pr: 1, merged_sha: 'aaaa', evidence: ['PR #1 merged at aaaa'] }),
    item({ id: 'T002', title: 'B', deps: ['T001'], write_surface: ['packages/b/'], status: 'ready' }),
    item({ id: 'T003', title: 'C', deps: ['T002'], write_surface: ['packages/a/sub/', 'packages/c/'], status: 'blocked' }),
  ];
  const workItems = new Map([
    ['T001', { id: 'T001', title: 'A', deps: [], writeSurface: ['packages/a/'] }],
    ['T002', { id: 'T002', title: 'B', deps: ['T001'], writeSurface: ['packages/b/'] }],
    ['T003', { id: 'T003', title: 'C', deps: ['T002'], writeSurface: ['packages/a/sub/', 'packages/c/'] }],
  ]);
  const depGraph = new Map([
    ['T001', []],
    ['T002', ['T001']],
    ['T003', ['T002']],
  ]);
  return { graph: baseGraph(items), workItems, depGraph };
}

describe('markdown parsing', () => {
  it('parses a table row into trimmed cells', () => {
    expect(splitRow('| T001 | Title, with comma | — | root, packages/ |')).toEqual([
      'T001',
      'Title, with comma',
      '—',
      'root, packages/',
    ]);
  });

  it('parses the real WORK-ITEMS.md into exactly 50 items', () => {
    const items = parseWorkItems(fs.readFileSync(WORK_ITEMS_PATH, 'utf8'));
    expect(items.size).toBe(50);
    expect(items.get('T001')?.deps).toEqual([]);
    expect(items.get('T004')?.deps).toEqual(['T001']);
    expect(items.get('T048')?.deps).toContain('T040');
  });

  it('parses the real DEPENDENCY-GRAPH.md including multi-source lines', () => {
    const dg = parseDependencyGraph(fs.readFileSync(DEP_GRAPH_PATH, 'utf8'));
    expect(dg.size).toBe(50);
    // "T021,T022,T023 -> T024" must expand into three edges.
    expect(dg.get('T024')).toEqual(expect.arrayContaining(['T021', 'T022', 'T023']));
  });

  it('WORK-ITEMS and DEPENDENCY-GRAPH agree on every dependency (post D-001 reconciliation)', () => {
    const wi = parseWorkItems(fs.readFileSync(WORK_ITEMS_PATH, 'utf8'));
    const dg = parseDependencyGraph(fs.readFileSync(DEP_GRAPH_PATH, 'utf8'));
    for (const [id, entry] of wi) {
      expect([...(entry.deps ?? [])].sort(), id).toEqual([...(dg.get(id) ?? [])].sort());
    }
  });
});

describe('surface overlap semantics', () => {
  it('root conflicts only with root', () => {
    expect(surfacesOverlap('root', 'root')).toBe(true);
    expect(surfacesOverlap('root', 'packages/domain-core/')).toBe(false);
  });

  it('detects containment and equality, ignores sibling directories', () => {
    expect(surfacesOverlap('packages/', 'packages/domain-core/')).toBe(true);
    expect(surfacesOverlap('packages/domain-core/', 'packages/domain-core/contracts/')).toBe(true);
    expect(surfacesOverlap('packages/domain-core/', 'packages/agent-body/')).toBe(false);
    expect(surfacesOverlap('packages/domain-core', 'packages/domain-core/')).toBe(true);
  });
});

describe('validate()', () => {
  it('accepts a valid synthetic world and computes the frontier', () => {
    const world = syntheticWorld();
    const res = validate({ ...world, expectedIds: ['T001', 'T002', 'T003'] });
    expect(res.violations).toEqual([]);
    expect(res.frontier).toEqual(['T002']); // T003 still blocked by T002
  });

  it('rejects a dependency cycle', () => {
    const world = syntheticWorld();
    world.graph.items[1].deps = ['T001', 'T003']; // B <-> C cycle
    world.workItems.get('T002')!.deps = ['T001', 'T003'];
    world.depGraph.set('T002', ['T001', 'T003']);
    const res = validate({ ...world, expectedIds: ['T001', 'T002', 'T003'] });
    expect(res.violations.join('\n')).toMatch(/cycle/);
  });

  it('rejects a non-blocked item whose dependencies are not merged', () => {
    const world = syntheticWorld();
    world.graph.items[2].status = 'ready'; // C ready while B is not merged
    const res = validate({ ...world, expectedIds: ['T001', 'T002', 'T003'] });
    expect(res.violations.join('\n')).toMatch(/T003: status "ready" is illegal/);
  });

  it('rejects a merged item without evidence', () => {
    const world = syntheticWorld();
    world.graph.items[0].evidence = [];
    const res = validate({ ...world, expectedIds: ['T001', 'T002', 'T003'] });
    expect(res.violations.join('\n')).toMatch(/T001: merged requires at least one evidence entry/);
  });

  it('rejects in_review without a PR number', () => {
    const world = syntheticWorld();
    world.graph.items[1].status = 'in_review';
    world.graph.items[1].branch = 'work/b';
    world.graph.items[1].pr = null;
    const res = validate({ ...world, expectedIds: ['T001', 'T002', 'T003'] });
    expect(res.violations.join('\n')).toMatch(/T002: in_review requires branch and pr/);
  });

  it('rejects active work orders with overlapping write surfaces', () => {
    const world = syntheticWorld();
    world.graph.items[1].status = 'in_progress';
    world.graph.items[1].branch = 'work/b';
    // Give C (blocked, so not active) nothing; instead make a second active item
    // overlapping B: mutate T003 into an independent active item.
    world.graph.items[2].deps = [];
    world.graph.items[2].status = 'in_progress';
    world.graph.items[2].branch = 'work/c';
    world.graph.items[2].write_surface = ['packages/b/overlap/'];
    world.workItems.get('T003')!.deps = [];
    world.workItems.get('T003')!.writeSurface = ['packages/b/overlap/'];
    world.depGraph.set('T003', []);
    const res = validate({ ...world, expectedIds: ['T001', 'T002', 'T003'] });
    expect(res.violations.join('\n')).toMatch(/overlapping write surfaces/);
  });

  it('rejects dependency drift between graph.json and markdown', () => {
    const world = syntheticWorld();
    world.graph.items[1].deps = ['T001', 'T099']; // unknown dep + drift
    const res = validate({ ...world, expectedIds: ['T001', 'T002', 'T003'] });
    expect(res.violations.join('\n')).toMatch(/deps differ between program\/graph\.json and spec\/WORK-ITEMS\.md/);
    expect(res.violations.join('\n')).toMatch(/T002: invalid deps entry/);
  });

  it('rejects write-surface drift between graph.json and markdown', () => {
    const world = syntheticWorld();
    world.graph.items[1].write_surface = ['packages/b/', 'packages/stolen/'];
    const res = validate({ ...world, expectedIds: ['T001', 'T002', 'T003'] });
    expect(res.violations.join('\n')).toMatch(/write_surface differs/);
  });
});

describe('live repository program state (integration)', () => {
  it('program/graph.json validates against both markdown authorities', () => {
    const graph = loadGraph(fs.readFileSync(GRAPH_JSON_PATH, 'utf8'));
    const workItems = parseWorkItems(fs.readFileSync(WORK_ITEMS_PATH, 'utf8'));
    const depGraph = parseDependencyGraph(fs.readFileSync(DEP_GRAPH_PATH, 'utf8'));
    const res = validate({ graph, workItems, depGraph });
    expect(res.violations).toEqual([]);
    expect(graph.items).toHaveLength(50);
  });
});
