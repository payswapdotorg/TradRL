import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const required = [
  'README.md','AGENTS.md','AI_CONTINUATION.md','CONTRIBUTING.md',
  'spec/PROJECT-STATE.md','spec/ARCHITECTURE.md','spec/ARCHITECTURE-LOCK.md','spec/REQUIREMENTS.md',
  'spec/DOMAIN-MODEL.md','spec/LEARNING-LOOP.md','spec/EVALUATION-PROTOCOL.md','spec/ADAPTERS.md',
  'spec/SECURITY.md','spec/UX.md','spec/COMPETITIVE-ADOPTION.md','spec/WORK-ITEMS.md',
  'spec/DEPENDENCY-GRAPH.md','spec/WORKER-RUNBOOK.md','spec/WORK-ORDER-TEMPLATE.md','spec/TRACEABILITY.md',
  'docs/LLM-ARCHITECT-HANDOFF.md','docs/ARCHITECT-QUICKSTART.md',
  'docs/adr/ADR-0001-standalone-learning-arena.md','docs/adr/ADR-0002-project-primary-primitive.md',
  'program/graph.json','.github/workflows/ci.yml','.github/PULL_REQUEST_TEMPLATE.md',
  'packages/domain-core','packages/agent-body','packages/market-protocol','packages/time-engine',
];
for (const file of required) if (!fs.existsSync(path.join(root,file))) throw new Error(`Missing ${file}`);
for (const file of ['README.md','AGENTS.md','spec/ARCHITECTURE-LOCK.md','docs/LLM-ARCHITECT-HANDOFF.md']) {
  const content = fs.readFileSync(path.join(root,file),'utf8');
  if (!/Arena/i.test(content) || !/(optional|without Arena|not.*depend)/i.test(content)) throw new Error(`Arena boundary missing in ${file}`);
}
const work = fs.readFileSync(path.join(root,'spec/WORK-ITEMS.md'),'utf8');
const graph = fs.readFileSync(path.join(root,'spec/DEPENDENCY-GRAPH.md'),'utf8');
for (let i=1;i<=50;i++) { const id=`T${String(i).padStart(3,'0')}`; if(!work.includes(id)||!graph.includes(id)) throw new Error(`Missing ${id}`); }

// Machine-checkable program state must exist and cover the whole program.
const program = JSON.parse(fs.readFileSync(path.join(root,'program/graph.json'),'utf8'));
if (!Array.isArray(program.items)) throw new Error('program/graph.json: items must be an array');
const ids = new Set(program.items.map((i)=>i.id));
if (ids.size !== program.items.length) throw new Error('program/graph.json: duplicate item ids');
for (let i=1;i<=50;i++) { const id=`T${String(i).padStart(3,'0')}`; if(!ids.has(id)) throw new Error(`program/graph.json missing ${id}`); }

// The Work Order(s) PROJECT-STATE declares authorized must exist and not be merged.
const state = fs.readFileSync(path.join(root,'spec/PROJECT-STATE.md'),'utf8');
const authRow = state.match(/Current authorized Work Order\s*\|\s*([^|\n]+)/);
if (authRow) {
  const authorized = [...authRow[1].matchAll(/T\d{3}/g)].map((m) => m[0]);
  for (const id of authorized) {
    const it = program.items.find((i)=>i.id===id);
    if (!it) throw new Error(`Authorized ${id} missing from program/graph.json`);
    if (it.status === 'merged') throw new Error(`Authorized ${id} is already merged — update spec/PROJECT-STATE.md`);
  }
} else {
  throw new Error('spec/PROJECT-STATE.md: "Current authorized Work Order" row missing');
}
console.log('TradRL governance self-test passed.');
