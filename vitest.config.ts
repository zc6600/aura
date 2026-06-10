import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
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
