import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { execa } from 'execa';
import picocolors from 'picocolors';
import yaml from 'yaml';
import { ToolRegistry } from '../../core/kernel/registry.js';
import * as PromptRegistry from '../../core/llm/prompts/registry.js';
import { loadWorkflow } from '../../core/workflow/manifest.js';
import { checkWorkflow } from '../../core/workflow/runner.js';
import * as GlobalConfig from '../../utils/globalConfig.js';
import * as PathResolver from '../../utils/pathResolver.js';
import { errorMessage } from '../../utils/typing.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const Doctor = {
  async run(
    options: { prompts?: boolean; workspace?: boolean } = {},
  ): Promise<void> {
    if (options.prompts) {
      Doctor.loadDotenvFiles();
      Doctor.checkPrompts();
      return;
    }
    if (options.workspace) {
      Doctor.checkWorkspace();
      return;
    }

    console.log('='.repeat(70));
    console.log(
      picocolors.bold(
        picocolors.blue('🌟 Aura OS - Environment Health Checks'),
      ),
    );
    console.log('='.repeat(70));
    console.log(`Node: ${process.version}`);

    // Check Git
    try {
      const { stdout } = await execa('git', ['--version']);
      console.log(`Git: ${stdout.trim()}`);
    } catch {
      console.log(picocolors.red('Git: Not found!'));
      console.log('💡 To install Git:');
      console.log('   - macOS: brew install git');
      console.log('   - Ubuntu/Debian: sudo apt-get install git');
    }

    // Check Docker
    try {
      const { stdout: dockerVer } = await execa('docker', ['--version']);
      console.log(`Docker: ${dockerVer.trim()}`);

      // Check daemon
      let daemonVersion: string | null = null;
      try {
        const { stdout } = await execa(
          'docker',
          ['info', '--format', '{{.ServerVersion}}'],
          { timeout: 2500 },
        );
        daemonVersion = stdout.trim();
      } catch {}

      if (daemonVersion) {
        console.log(
          `Docker Daemon: ${picocolors.green('Running')} (${daemonVersion})`,
        );

        // Check buildx
        try {
          const { stdout: buildxVer } = await execa(
            'docker',
            ['buildx', 'version'],
            { timeout: 2000 },
          );
          console.log(`Docker Buildx: ${buildxVer.trim()}`);
        } catch {
          console.log(
            picocolors.yellow(
              '⚠️ Docker Buildx: Not available (optional but recommended)',
            ),
          );
        }

        // Check sandbox image
        const sandboxImage = 'aura-sandbox';
        try {
          const { stdout: imagesOut } = await execa(
            'docker',
            ['images', '--format', '{{.Repository}}:{{.Tag}}', sandboxImage],
            { timeout: 2000 },
          );
          if (imagesOut.trim()) {
            console.log(
              `Sandbox Image: ${picocolors.green(`${sandboxImage} found`)}`,
            );
          } else {
            console.log(
              picocolors.yellow(`⚠️ Sandbox Image: '${sandboxImage}' not found`),
            );
            console.log('💡 To build it for the current workspace:');
            const auraDir = PathResolver.findAuraDir(process.cwd());
            const displayDir = auraDir
              ? path.basename(auraDir)
              : '.aura-workspace';
            console.log(
              `   $ docker build -t ${sandboxImage} -f ${displayDir}/Dockerfile.sandbox ${displayDir}`,
            );
          }
        } catch {
          console.log(picocolors.yellow(`⚠️ Sandbox Image check failed`));
        }
      } else {
        console.log(
          picocolors.red('Docker Daemon: Not running or unresponsive'),
        );
        console.log(
          '💡 Start Docker Desktop or run: sudo systemctl start docker',
        );
      }
    } catch {
      console.log(picocolors.red('Docker: Not found!'));
      console.log('💡 To install Docker:');
      console.log('   - macOS: brew install --cask docker');
      console.log(
        '   - Ubuntu/Debian: Follow https://docs.docker.com/engine/install/',
      );
    }

    // Check SQLite3
    try {
      const { stdout } = await execa('sqlite3', ['--version']);
      const sqliteVer = stdout.trim().split(/\s+/)[0];
      console.log(`SQLite3: ${sqliteVer}`);
    } catch {
      console.log(
        picocolors.yellow(
          '⚠️ SQLite3: CLI not found (better-sqlite3 may still work)',
        ),
      );
    }

    // Check Global Repo
    try {
      await GlobalConfig.ensureRepo();
      console.log(
        `Global Repository (~/.aura-framework/repo): ${picocolors.green('OK')}`,
      );
    } catch (e: unknown) {
      console.log(
        picocolors.red(
          `Global Repository: Failed to initialize! (${errorMessage(e)})`,
        ),
      );
    }

    // Check LLM Configuration
    Doctor.loadDotenvFiles();

    const workspacePath = PathResolver.findAuraDir(process.cwd());
    const cfgPath = PathResolver.resolveConfigPath(
      workspacePath || GlobalConfig.repoPath(),
    );

    let provider: string | null = null;
    let apiKeySet = false;
    let envVarName: string | null = null;

    if (cfgPath && fs.existsSync(cfgPath)) {
      try {
        const raw = fs.readFileSync(cfgPath, 'utf-8');
        const cfg = yaml.parse(raw) || {};
        const llmCfg = cfg.llm || {};
        provider = llmCfg.provider;
        if (provider?.trim()) {
          envVarName = Doctor.getEnvVarName(provider);
          // API keys must come from environment variables (.env), not config.yml.
          // config.yml is for non-secret settings (provider, model, api_base) only.
          apiKeySet = !!(envVarName && process.env[envVarName]?.trim());
        }
      } catch {}
    }

    if (!provider?.trim()) {
      console.log(picocolors.yellow('⚠️ LLM Provider: Not configured'));
      console.log('💡 To configure your LLM provider, run:');
      console.log(
        '   $ aura config llm.provider <provider>  (e.g., openai, openrouter, anthropic, gemini)',
      );
    } else if (!apiKeySet) {
      console.log(
        picocolors.yellow(`⚠️ LLM API Key: Missing for provider '${provider}'`),
      );
      if (envVarName) {
        console.log('💡 To set the API key in your environment (.env), run:');
        console.log(`   $ aura env set ${envVarName} <your_api_key> --global`);
        console.log('💡 Or export the environment variable in your terminal:');
        console.log(`   $ export ${envVarName}=<your_api_key>`);
      } else {
        console.log('💡 To set the API key in config, run:');
        console.log('   $ aura config llm.api_key <your_api_key>');
      }
    } else {
      console.log(
        `LLM Config (Provider: ${provider}): ${picocolors.green('OK')}`,
      );
    }

    console.log(`Aura CLI: ${picocolors.green('OK')}`);

    console.log('\nChecking prompt templates...');
    Doctor.checkPrompts();
    console.log('='.repeat(70));
  },

  checkWorkspace(): void {
    const root = PathResolver.resolveProjectPath(undefined) || process.cwd();
    const checks: Array<{ label: string; ok: boolean; detail?: string }> = [];
    checks.push({
      label: 'workspace root',
      ok: fs.existsSync(path.join(root, '.aura-workspace')),
      detail: root,
    });
    checks.push({
      label: 'config',
      ok: fs.existsSync(
        path.join(root, '.aura-workspace', 'config', 'config.yml'),
      ),
      detail: '.aura-workspace/config/config.yml',
    });
    try {
      const registry = new ToolRegistry(root);
      checks.push({
        label: 'tools registry',
        ok: true,
        detail: `${registry.allTools().length} tool(s)`,
      });
    } catch (e: unknown) {
      checks.push({
        label: 'tools registry',
        ok: false,
        detail: (e as Error).message,
      });
    }
    const hasWorkflow =
      fs.existsSync(path.join(root, 'workflow.yml')) ||
      fs.existsSync(path.join(root, 'workflows'));
    if (hasWorkflow) {
      try {
        const workflow = loadWorkflow(root);
        for (const check of checkWorkflow(workflow)) {
          checks.push({
            label: `workflow ${check.label}`,
            ok: check.ok,
            detail: check.detail,
          });
        }
      } catch (e: unknown) {
        checks.push({
          label: 'workflow',
          ok: false,
          detail: (e as Error).message,
        });
      }
    } else {
      checks.push({
        label: 'workflow',
        ok: true,
        detail: 'not declared',
      });
    }

    console.log(picocolors.blue('=== Aura Workspace Doctor ==='));
    for (const check of checks) {
      const mark = check.ok ? picocolors.green('✓') : picocolors.red('✗');
      const detail = check.detail ? picocolors.gray(` (${check.detail})`) : '';
      console.log(`${mark} ${check.label}${detail}`);
    }
    const failed = checks.filter((check) => !check.ok);
    if (failed.length > 0) {
      throw new Error(`${failed.length} workspace check(s) failed.`);
    }
  },

  checkPrompts(): void {
    const auraDir = PathResolver.findAuraDir(process.cwd());
    const workspacePath = auraDir ? path.dirname(auraDir) : process.cwd();
    console.log(`Workspace Root: ${workspacePath}`);

    // Validate standard prompt
    console.log('\n[Standard Mode Prompt]');
    try {
      const standardPrompt = PromptRegistry.resolve('standard', workspacePath);
      Doctor.validateAndPrintPrompt('standard', standardPrompt);
    } catch (e: unknown) {
      console.log(picocolors.red(`  Failed to resolve: ${errorMessage(e)}`));
    }

    // Validate Ralph developer prompt
    console.log('\n[Ralph Developer Prompt]');
    try {
      const ralphDevPrompt = PromptRegistry.resolve(
        'ralph_developer',
        workspacePath,
      );
      Doctor.validateAndPrintPrompt('ralph_developer', ralphDevPrompt);
    } catch (e: unknown) {
      console.log(picocolors.red(`  Failed to resolve: ${errorMessage(e)}`));
    }

    // Validate Ralph critic prompt
    console.log('\n[Ralph Critic Prompt]');
    try {
      const ralphCriticPrompt = PromptRegistry.resolve(
        'ralph_critic',
        workspacePath,
      );
      Doctor.validateAndPrintPrompt('ralph_critic', ralphCriticPrompt);
    } catch (e: unknown) {
      console.log(picocolors.red(`  Failed to resolve: ${errorMessage(e)}`));
    }

    // Sync checks
    Doctor.checkOverridesSync(workspacePath);
  },

  validateAndPrintPrompt(mode: string, prompt: string): void {
    const charCount = prompt.length;
    console.log(
      `  Compiled Length: ${charCount} chars (~${Math.round(charCount / 4.0)} tokens)`,
    );

    if (charCount > 100000) {
      console.log(
        picocolors.red(
          '  ❌ Warning: Prompt length exceeds 100k characters. This may cause large latency or API costs.',
        ),
      );
    } else if (charCount > 20000) {
      console.log(
        picocolors.yellow(
          `  ⚠️ Warning: Prompt length is large (${charCount} chars). Check if all sections are necessary.`,
        ),
      );
    } else {
      console.log(`  Length constraint: ${picocolors.green('OK')}`);
    }

    const issues = PromptRegistry.validatePrompt(prompt, mode);
    if (issues.length > 0) {
      for (const iss of issues) {
        console.log(picocolors.yellow(`  ⚠� ${iss}`));
      }
    } else {
      console.log(`  Structure validation: ${picocolors.green('OK')}`);
    }
  },

  checkOverridesSync(workspacePath: string): void {
    const legacy = path.join(workspacePath, 'skills', 'system.md');
    if (fs.existsSync(legacy)) {
      console.log('\n[Workspace Prompt Sync]');
      console.log('  Found legacy system override at skills/system.md.');
      console.log(
        '  💡 Note: Modular prompt section overrides (prompts/system/*.md) will be ignored because skills/system.md takes precedence.',
      );
    }

    const overrideDir = path.join(workspacePath, 'prompts', 'system');
    if (
      !fs.existsSync(overrideDir) ||
      !fs.statSync(overrideDir).isDirectory()
    ) {
      return;
    }

    console.log('\n[Workspace Prompt Sync]');
    const files = fs.readdirSync(overrideDir).filter((f) => f.endsWith('.md'));

    // Default defaultDir in registry
    const defaultDir = PromptRegistry.getDefaultSystemPromptDir();

    for (const file of files) {
      const overrideFile = path.join(overrideDir, file);
      console.log(`  Found modular override: prompts/system/${file}`);

      const defaultPath = path.join(defaultDir, file);
      if (fs.existsSync(defaultPath)) {
        const defaultContent = fs.readFileSync(defaultPath, 'utf-8');
        const overrideContent = fs.readFileSync(overrideFile, 'utf-8');
        if (defaultContent.trim() === overrideContent.trim()) {
          console.log(
            picocolors.yellow(
              '    ⚠️ Identical to system default. Consider removing this override to receive future framework updates.',
            ),
          );
        }
      }
    }
  },

  loadDotenvFiles(): void {
    const candidates = [
      path.join(GlobalConfig.auraHome(), '.env'),
      path.join(process.cwd(), '.env'),
    ];

    const auraDir = PathResolver.findAuraDir(process.cwd());
    if (auraDir) {
      candidates.push(path.join(path.dirname(auraDir), '.env'));
    }

    const uniqueCandidates = Array.from(new Set(candidates));

    for (const envFile of uniqueCandidates) {
      if (!fs.existsSync(envFile)) continue;
      try {
        const content = fs.readFileSync(envFile);
        const parsed = dotenv.parse(content);
        for (const key of Object.keys(parsed)) {
          if (!process.env[key]) {
            process.env[key] = parsed[key];
          }
        }
      } catch {}
    }
  },

  getEnvVarName(provider: string): string | null {
    if (!provider || provider.trim().length === 0) return null;
    return `${provider.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`;
  },
};
