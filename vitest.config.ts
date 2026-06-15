import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sandboxRoot = path.join(__dirname, 'tests', '.sandbox');
const sandboxHome = path.join(sandboxRoot, 'home');
const sandboxAuraHome = path.join(sandboxHome, '.aura-framework');
const sandboxTmp = path.join(sandboxRoot, 'tmp');

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
      HOME: sandboxHome,
      USERPROFILE: sandboxHome,
      TMPDIR: sandboxTmp,
      TEMP: sandboxTmp,
      TMP: sandboxTmp,
      AURA_HOME: sandboxAuraHome,
      AURA_GLOBAL_REPO_PATH: path.join(sandboxAuraHome, 'repo'),
      AURA_GLOBAL_PROJECTS_CONFIG_PATH: path.join(
        sandboxAuraHome,
        'projects.yml',
      ),
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
