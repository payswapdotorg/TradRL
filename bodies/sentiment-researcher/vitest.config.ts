import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Per-package test runner (Work Order T021, following the T037 adapters
// precedent). The ROOT vitest include globs on this branch do not cover
// bodies/* (they cover packages/**, services/**, adapters/** and tests/**);
// the frozen-surface law forbids root config edits, so this package ships
// its own runner config and is verified with:
//   pnpm exec vitest run --config bodies/sentiment-researcher/vitest.config.ts
// Cross-package imports (the real @tradrl/agent-body, @tradrl/skills,
// @tradrl/evaluation, @tradrl/provenance, @tradrl/agent-os and the T038
// adapters, for the interop drift trip-wires) happen ONLY in tests, via
// relative paths — the repo's established pattern (law D-004: the package
// sources import nothing outside their own lane).
export default defineConfig({
  root: dirname(fileURLToPath(import.meta.url)),
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
