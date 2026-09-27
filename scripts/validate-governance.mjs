import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const required = [
  'README.md','AGENTS.md','AI_CONTINUATION.md','CONTRIBUTING.md',
  'spec/PROJECT-STATE.md','spec/ARCHITECTURE.md','spec/ARCHITECTURE-LOCK.md','spec/REQUIREMENTS.md',
  'spec/DOMAIN-MODEL.md','spec/LEARNING-LOOP.md','spec/EVALUATION-PROTOCOL.md','spec/ADAPTERS.md',
  'spec/SECURITY.md','spec/UX.md','spec/COMPETITIVE-ADOPTION.md','spec/WORK-ITEMS.md',
  'spec/DEPENDENCY-GRAPH.md','spec/WORKER-RUNBOOK.md','spec/WORK-ORDER-TEMPLATE.md',
  'docs/LLM-ARCHITECT-HANDOFF.md','docs/ARCHITECT-QUICKSTART.md',
  'docs/adr/ADR-0001-standalone-learning-arena.md','docs/adr/ADR-0002-project-primary-primitive.md'
];
for (const file of required) if (!fs.existsSync(path.join(root,file))) throw new Error(`Missing ${file}`);
for (const file of ['README.md','AGENTS.md','spec/ARCHITECTURE-LOCK.md','docs/LLM-ARCHITECT-HANDOFF.md']) {
  const content = fs.readFileSync(path.join(root,file),'utf8');
  if (!/Arena/i.test(content) || !/(optional|without Arena|not.*depend)/i.test(content)) throw new Error(`Arena boundary missing in ${file}`);
}
const work = fs.readFileSync(path.join(root,'spec/WORK-ITEMS.md'),'utf8');
const graph = fs.readFileSync(path.join(root,'spec/DEPENDENCY-GRAPH.md'),'utf8');
for (let i=1;i<=50;i++) { const id=`T${String(i).padStart(3,'0')}`; if(!work.includes(id)||!graph.includes(id)) throw new Error(`Missing ${id}`); }
const state = fs.readFileSync(path.join(root,'spec/PROJECT-STATE.md'),'utf8');
if (!/Current authorized Work Order.*T001/s.test(state)) throw new Error('T001 not authorized');
console.log('TradRL governance self-test passed.');