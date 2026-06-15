import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/bin/aura.ts', 'src/bin/daemon.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
  shims: true, // Inject CJS/ESM shims like __dirname for node compatibility
  async onSuccess() {
    // Copy prompts
    const srcPrompts = path.join(
      process.cwd(),
      'src',
      'core',
      'llm',
      'prompts',
      'system',
    );
    const distPrompts = path.join(process.cwd(), 'dist', 'system');
    if (fs.existsSync(srcPrompts)) {
      fs.cpSync(srcPrompts, distPrompts, { recursive: true });
      console.log('✓ Copied system prompts to dist/system');
    }

    // Copy generators templates
    const srcTemplates = path.join(
      process.cwd(),
      'src',
      'generators',
      'aura',
      'app',
      'templates',
    );
    const distTemplates = path.join(
      process.cwd(),
      'dist',
      'generators',
      'aura',
      'app',
      'templates',
    );
    if (fs.existsSync(srcTemplates)) {
      fs.cpSync(srcTemplates, distTemplates, { recursive: true });
      console.log('✓ Copied generators templates to dist/generators');
    }
  },
});
