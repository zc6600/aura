import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sandboxRoot = path.join(__dirname, 'tests', '.sandbox');

export default defineConfig({
  server: {
    watch: {
      ignored: [
        '**/tests/.sandbox/**',
        '**/tests/**/temp-*/**',
        '**/tests/**/tmp*/**',
        '**/.aura-workspace/**',
      ],
    },
  },
  test: {
    globalSetup: path.join(__dirname, 'tests', 'globalSetup.ts'),
    // Gives each test FILE its own AURA_HOME/repo/projects.yml — see the
    // file for why: sharing one across concurrent files raced under load.
    setupFiles: [path.join(__dirname, 'tests', 'setupSandboxIsolation.ts')],
    hookTimeout: 30000,
    testTimeout: 60000,
    exclude: [...configDefaults.exclude, 'tests/.sandbox/**'],
    watchExclude: [
      'tests/.sandbox/**',
      'tests/**/temp-*/**',
      'tests/**/tmp*/**',
      '**/.aura-workspace/**',
    ],
    env: {
      // Shared and short on purpose: unix socket paths have a ~104 byte
      // limit and this repo's absolute path already leaves little headroom.
      // Safe to share — socket filenames are content-hashed per project
      // path, so concurrent test files never collide on the same file here.
      AURA_DAEMON_SOCKET_DIR: path.join(sandboxRoot, 'sockets'),
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
