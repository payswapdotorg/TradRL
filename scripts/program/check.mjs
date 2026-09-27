#!/usr/bin/env node
// TradRL program-state checker.
// Validates that program/graph.json (machine state), spec/WORK-ITEMS.md
// (work order catalog) and spec/DEPENDENCY-GRAPH.md (readiness authority)
// agree, that the dependency graph is a DAG, that item statuses are legal
// given dependency status, that merged items carry evidence, and that the
// active wave has pairwise-disjoint write surfaces within the concurrency
// limit. Exit code 0 = valid.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const WORK_ITEMS_PATH = path.join(ROOT, 'spec/WORK-ITEMS.md');
export const DEP_GRAPH_PATH = path.join(ROOT, 'spec/DEPENDENCY-GRAPH.md');
export const GRAPH_JSON_PATH = path.join(ROOT, 'program/graph.json');

const ALL_IDS = Array.from({ length: 50 }, (_, i) => `T${String(i + 1).padStart(3, '0')}`);
const STATUSES = ['blocked', 'ready', 'in_progress', 'in_review', 'merged'];
const ACTIVE_STATUSES = ['in_progress', 'in_review'];

/** Parse a markdown table row into trimmed cells (without leading/trailing empties). */
export function splitRow(line) {
  return line.split('|').slice(1, -1).map((c) => c.trim());
}

/** Parse spec/WORK-ITEMS.md into id -> { title, deps, writeSurface }. */
export function parseWorkItems(md) {
  const items = new Map();
  for (const line of md.split('\n')) {
    if (!/^\|\s*T\d{3}\s*\|/.test(line)) continue;
    const cells = splitRow(line);
    if (cells.length < 4) continue;
    const [id, title, depCell, surfaceCell] = cells;
    const deps = depCell === '—' || depCell === '-' || depCell === '' ? [] : depCell.split(',').map((d) => d.trim());
    const writeSurface = surfaceCell.split(',').map((s) => s.trim()).filter(Boolean);
    items.set(id, { id, title, deps, writeSurface });
  }
  return items;
}

/** Parse spec/DEPENDENCY-GRAPH.md edge list into id -> sorted deps. */
export function parseDependencyGraph(md) {
  const deps = new Map(ALL_IDS.map((id) => [id, new Set()]));
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    const m = /^(T\d{3}(?:\s*,\s*T\d{3})*)\s*->\s*(.+)$/.exec(line);
    if (!m) continue;
    const lefts = m[1].split(',').map((s) => s.trim());
    const rights = m[2].trim();
    if (rights === 'terminal') continue;
    for (const r of rights.split(',')) {
      const target = r.trim();
      if (!/^T\d{3}$/.test(target)) continue;
      for (const l of lefts) deps.get(target).add(l);
    }
  }
  return new Map([...deps].map(([id, set]) => [id, [...set].sort()]));
}

/** Load and shape program/graph.json. */
export function loadGraph(json) {
  const g = typeof json === 'string' ? JSON.parse(json) : json;
  if (!Array.isArray(g.items)) throw new Error('program/graph.json: items must be an array');
  return g;
}

function sameList(a, b) {
  return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
}

/** Do two declared write-surface entries overlap? */
export function surfacesOverlap(a, b) {
  const norm = (p) => (p === 'root' ? '.' : p.replace(/\/+$/, '') + '/');
  if (a === 'root' && b === 'root') return true;
  if (a === 'root' || b === 'root') return false; // "root" means root-level files only
  const na = norm(a);
  const nb = norm(b);
  return na === nb || na.startsWith(nb) || nb.startsWith(na);
}

/**
 * Validate everything. Returns { violations, warnings, frontier, stats }.
 * `expectedIds` defaults to the full program; unit tests may pass a smaller world.
 */
export function validate({ graph, workItems, depGraph, maxConcurrent = 3, expectedIds = ALL_IDS }) {
  const violations = [];
  const warnings = [];
  const byId = new Map(graph.items.map((it) => [it.id, it]));

  // 1. Completeness and uniqueness of item ids.
  const ids = graph.items.map((it) => it.id);
  const expected = new Set(expectedIds);
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) violations.push(`duplicate item ${id} in program/graph.json`);
    seen.add(id);
  }
  for (const id of expectedIds) {
    if (!seen.has(id)) violations.push(`program/graph.json missing ${id}`);
    if (!workItems.has(id)) violations.push(`spec/WORK-ITEMS.md missing row ${id}`);
    if (!depGraph.has(id)) violations.push(`spec/DEPENDENCY-GRAPH.md missing ${id}`);
  }
  for (const id of seen) {
    if (!expected.has(id)) violations.push(`program/graph.json has unknown item ${id}`);
  }

  // 2. Three-way dependency / title / write-surface consistency.
  for (const it of graph.items) {
    const wi = workItems.get(it.id);
    const dg = depGraph.get(it.id);
    if (!wi || !dg) continue;
    if (!sameList(it.deps ?? [], wi.deps))
      violations.push(`${it.id}: deps differ between program/graph.json and spec/WORK-ITEMS.md (${JSON.stringify(it.deps)} vs ${JSON.stringify(wi.deps)})`);
    if (!sameList(it.deps ?? [], dg))
      violations.push(`${it.id}: deps differ between program/graph.json and spec/DEPENDENCY-GRAPH.md (${JSON.stringify(it.deps)} vs ${JSON.stringify(dg)})`);
    if ((it.title ?? '').trim() !== wi.title.trim())
      violations.push(`${it.id}: title differs between program/graph.json and spec/WORK-ITEMS.md`);
    if (!sameList(it.write_surface ?? [], wi.writeSurface))
      violations.push(`${it.id}: write_surface differs between program/graph.json and spec/WORK-ITEMS.md (${JSON.stringify(it.write_surface)} vs ${JSON.stringify(wi.writeSurface)})`);
    if (!Array.isArray(it.deps) || it.deps.some((d) => !expected.has(d)))
      violations.push(`${it.id}: invalid deps entry`);
    if (!Array.isArray(it.write_surface) || it.write_surface.length === 0)
      violations.push(`${it.id}: write_surface must be a non-empty array`);
  }

  // 3. DAG check (iterative DFS).
  const color = new Map(); // 0=white 1=gray 2=black
  const stack = [...ids];
  const dfs = (start) => {
    const frames = [[start, 0]];
    while (frames.length) {
      const [id, i] = frames[frames.length - 1];
      if (i === 0) {
        if (color.get(id) === 1) return true; // cycle
        if (color.get(id) === 2) { frames.pop(); continue; }
        color.set(id, 1);
      }
      const deps = byId.get(id)?.deps ?? [];
      if (i < deps.length) {
        frames[frames.length - 1][1] += 1;
        frames.push([deps[i], 0]);
      } else {
        color.set(id, 2);
        frames.pop();
      }
    }
    return false;
  };
  for (const id of stack) {
    if (!color.has(id)) {
      if (dfs(id)) {
        violations.push('dependency graph contains a cycle');
        break;
      }
    }
  }

  // 4. Status legality.
  for (const it of graph.items) {
    if (!STATUSES.includes(it.status))
      violations.push(`${it.id}: illegal status "${it.status}" (allowed: ${STATUSES.join(', ')})`);
    const deps = it.deps ?? [];
    const depsMerged = deps.every((d) => byId.get(d)?.status === 'merged');
    if (!depsMerged && it.status !== 'blocked')
      violations.push(`${it.id}: status "${it.status}" is illegal while dependencies are not merged (${deps.filter((d) => byId.get(d)?.status !== 'merged').join(',')})`);
    if (it.status === 'in_progress' && !it.branch)
      violations.push(`${it.id}: in_progress requires a branch`);
    if (it.status === 'in_review' && (!it.branch || !it.pr))
      violations.push(`${it.id}: in_review requires branch and pr`);
    if (it.status === 'merged') {
      if (!it.branch || !it.pr || !it.merged_sha)
        violations.push(`${it.id}: merged requires branch, pr and merged_sha`);
      if (!Array.isArray(it.evidence) || it.evidence.length === 0)
        violations.push(`${it.id}: merged requires at least one evidence entry`);
      if (!depsMerged)
        violations.push(`${it.id}: merged but dependencies are not merged`);
    }
    if (Array.isArray(it.evidence) && it.evidence.some((e) => typeof e !== 'string' || !e.trim()))
      violations.push(`${it.id}: evidence entries must be non-empty strings`);
  }

  // 5. Active wave: concurrency limit + pairwise-disjoint write surfaces.
  const active = graph.items.filter((it) => ACTIVE_STATUSES.includes(it.status));
  if (active.length > maxConcurrent)
    violations.push(`active wave has ${active.length} work orders; policy maximum is ${maxConcurrent}`);
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      for (const sa of a.write_surface ?? []) {
        for (const sb of b.write_surface ?? []) {
          if (surfacesOverlap(sa, sb)) {
            violations.push(`active work orders ${a.id} and ${b.id} have overlapping write surfaces ("${sa}" vs "${sb}")`);
          }
        }
      }
    }
  }

  // 6. Frontier: items whose deps are all merged and which are not themselves merged.
  const frontier = graph.items
    .filter((it) => it.status !== 'merged' && (it.deps ?? []).every((d) => byId.get(d)?.status === 'merged'))
    .map((it) => it.id);

  const merged = graph.items.filter((it) => it.status === 'merged').map((it) => it.id);
  const stats = {
    total: graph.items.length,
    merged: merged.length,
    active: active.map((it) => it.id),
    frontier,
  };
  return { violations, warnings, frontier, stats };
}

/** Validate the live repository files. Exits non-zero on violation. */
export function run() {
  const graph = loadGraph(fs.readFileSync(GRAPH_JSON_PATH, 'utf8'));
  const workItems = parseWorkItems(fs.readFileSync(WORK_ITEMS_PATH, 'utf8'));
  const depGraph = parseDependencyGraph(fs.readFileSync(DEP_GRAPH_PATH, 'utf8'));
  const maxConcurrent = graph.policies?.max_concurrent_work_orders ?? 3;
  const { violations, warnings, stats } = validate({ graph, workItems, depGraph, maxConcurrent });
  console.log(`TradRL program state — ${stats.merged}/${stats.total} merged, active: [${stats.active.join(', ') || 'none'}]`);
  console.log(`Frontier (eligible for dispatch): [${stats.frontier.join(', ') || 'none'}]`);
  for (const w of warnings) console.log(`WARN: ${w}`);
  if (violations.length) {
    for (const v of violations) console.error(`VIOLATION: ${v}`);
    process.exitCode = 1;
  } else {
    console.log('Program state valid.');
  }
  return { violations, stats };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run();
}
