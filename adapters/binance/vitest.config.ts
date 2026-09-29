import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Per-package test runner (Work Order T037). The ROOT vitest include globs
// on this branch do not cover adapters/* (they cover packages/** and
// services/**); the frozen-surface law forbids root config edits, so this
// package ships its own runner config and is verified with:
//   pnpm exec vitest run --config adapters/binance/vitest.config.ts
// Cross-package imports (the real @tradrl/provider-sdk and
// @tradrl/market-protocol, for the interop drift trip-wires) happen ONLY in
// tests, via relative paths — the repo's established pattern (law D-004:
// the package sources import nothing).
export default defineConfig({
  root: dirname(fileURLToPath(import.meta.url)),
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
