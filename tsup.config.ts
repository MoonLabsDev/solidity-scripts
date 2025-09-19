import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'scripts/deployHelpers.ts',
    'scripts/flatten.ts',
    'scripts/cmdUtils.ts',
    'scripts/subgraphHelpers.ts',
    'scripts/testHelpers.ts',
    'scripts/hardhatLedger.ts',
  ],
  format: ['cjs'], // Build for commonJS and ESmodules
  dts: true, // Generate declaration file (.d.ts)
  splitting: false,
  sourcemap: true,
  clean: true,
});
