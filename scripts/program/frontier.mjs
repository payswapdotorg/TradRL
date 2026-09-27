#!/usr/bin/env node
// Prints the current dispatch frontier: work orders whose dependencies are
// all merged and which are not merged themselves.

import fs from 'node:fs';
import { GRAPH_JSON_PATH, loadGraph, run } from './check.mjs';

const graph = loadGraph(fs.readFileSync(GRAPH_JSON_PATH, 'utf8'));
const { stats, violations } = run();
if (violations.length) {
  console.error('Fix program-state violations before dispatching (pnpm program:check).');
  process.exitCode = 1;
} else {
  const byId = new Map(graph.items.map((it) => [it.id, it]));
  console.log('\nDispatch candidates (in dependency order):');
  for (const id of stats.frontier) {
    const it = byId.get(id);
    console.log(`  ${id} — ${it.title}`);
    console.log(`      surface: ${(it.write_surface ?? []).join(', ')}`);
  }
  const active = stats.active.length;
  const slots = (graph.policies?.max_concurrent_work_orders ?? 3) - active;
  console.log(`\nFree worker slots: ${slots}`);
}
