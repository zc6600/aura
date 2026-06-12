import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/bin/aura.ts', 'src/bin/daemon.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
  shims: true, // Inject CJS/ESM shims like __dirname for node compatibility
});
