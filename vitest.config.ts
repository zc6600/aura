import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  test: {
    env: {
      AURA_GLOBAL_PROJECTS_CONFIG_PATH: path.join(
        __dirname,
        'tests',
        'temp-projects',
        'projects.yml',
      ),
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'src/types/**/*',
        'src/cli/commands/**/*',
        'src/cli/shell/**/*',
        'src/daemon/**/*',
        'src/core/interface/**/*',
        'src/core/kernel/interfaces.ts',
        '**/*.d.ts',
        'tests/**/*',
        'dist/**/*',
      ],
    },
  },
});
