import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Per-package test runner (Work Order T039, following the T037/T038
// pattern). The ROOT vitest include globs on this branch also cover
// adapters/** (so `pnpm test` runs this package's suite); this config
// exists for the standalone per-package run:
//   pnpm exec vitest run --config adapters/brokers/vitest.config.ts
// Cross-package imports (the real @tradrl/provider-sdk,
// @tradrl/market-protocol and @tradrl/execution-policy, for the interop
// drift trip-wires) happen ONLY in tests, via relative paths — the repo's
// established pattern (law D-004: the package sources import nothing).
export default defineConfig({
  root: dirname(fileURLToPath(import.meta.url)),
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
