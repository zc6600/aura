import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import picocolors from 'picocolors';
import yaml from 'yaml';
import { VERSION } from '../../index.js';
import * as GlobalConfig from '../../utils/globalConfig.js';
import * as PathResolver from '../../utils/pathResolver.js';
import * as ProjectRegistry from '../../utils/projectRegistry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class Info {
  public static async run(): Promise<void> {
    await Info.displaySystemInfo();
    await Info.displayWorkspaceInfo();
  }

  private static async displaySystemInfo(): Promise<void> {
    console.log('='.repeat(70));
    console.log(
      picocolors.bold(picocolors.blue('🌟 Aura OS - System Information')),
    );
    console.log('='.repeat(70));

    console.log(`\n${picocolors.bold('📦 System:')}`);
    console.log(`  OS: ${os.platform()}`);
    console.log(`  Node: ${process.version}`);
    console.log(`  Architecture: ${os.arch()}`);

    console.log(`\n${picocolors.bold('🎯 Aura Framework:')}`);
    console.log(`  Version: ${VERSION}`);
    console.log(`  CLI Path: ${path.resolve(__dirname, '..', '..')}`);

    Info.displayGlobalEnvironment();
    Info.displayGlobalLLMConfig();
    await Info.displayDockerStatus();
    Info.displayRegisteredProjects();
  }

  private static displayGlobalEnvironment(): void {
    const globalPath = GlobalConfig.repoPath();
    const globalCfg =
      PathResolver.resolveConfigPath(globalPath) || 'Not configured';
    console.log(`\n${picocolors.bold('📁 Global Environment:')}`);
    console.log(`  Global Repository: ${globalPath}`);
    console.log(`  Global Config: ${globalCfg}`);
    console.log(
      `  Global Database: ${path.join(globalPath, 'state', 'aura.db')}`,
    );
  }

  private static displayGlobalLLMConfig(): void {
    const globalCfgPath = PathResolver.resolveConfigPath(
      GlobalConfig.repoPath(),
    );
    if (!globalCfgPath || !fs.existsSync(globalCfgPath)) return;

    try {
      const cfg = yaml.parse(fs.readFileSync(globalCfgPath, 'utf-8')) || {};
      const llmCfg = cfg.llm || {};
      const provider = llmCfg.provider || 'Not configured';
      const model = llmCfg.model || 'Default';
      const apiBase = llmCfg.api_base || 'Default';

      console.log(`\n${picocolors.bold('🤖 Global LLM Configuration:')}`);
      console.log(`  Provider: ${provider}`);
      console.log(`  Model: ${model}`);
      console.log(`  API Base: ${apiBase}`);

      const envVarName = Info.getEnvVarName(provider);
      let apiKeyStatus = picocolors.red('Not set');
      if (envVarName && process.env[envVarName]?.trim()) {
        apiKeyStatus = picocolors.green('Set (via environment)');
      } else if (llmCfg.api_key?.trim()) {
        apiKeyStatus = picocolors.green('Set (via config)');
      }

      console.log(`  API Key: ${apiKeyStatus}`);
    } catch {}
  }

  private static async displayDockerStatus(): Promise<void> {
    console.log(`\n${picocolors.bold('🐳 Docker Environment:')}`);
    try {
      const { stdout: dockerVer } = await execa('docker', ['--version']);
      console.log(`  Docker: ${dockerVer.trim()}`);

      let daemonRunning = false;
      try {
        await execa('docker', ['info'], { timeout: 2000 });
        daemonRunning = true;
      } catch {}

      if (daemonRunning) {
        console.log(`  Daemon: ${picocolors.green('Running')}`);

        let containersCount = 0;
        try {
          const { stdout: psOut } = await execa(
            'docker',
            ['ps', '-a', '--format', '{{.Names}}'],
            { timeout: 2000 },
          );
          containersCount = psOut.trim() ? psOut.trim().split('\n').length : 0;
        } catch {}
        console.log(`  Containers: ${containersCount} total`);
      } else {
        console.log(
          `  Daemon: ${picocolors.red('Not running or unresponsive')}`,
        );
      }
    } catch {
      console.log(`  Docker: ${picocolors.red('Not installed')}`);
    }
  }

  private static displayRegisteredProjects(): void {
    console.log(`\n${picocolors.bold('📋 Registered Projects:')}`);
    const projects = ProjectRegistry.registeredProjects();
    const keys = Object.keys(projects);
    if (keys.length > 0) {
      let activeCount = 0;
      let missingCount = 0;
      for (const name of keys) {
        const p = projects[name];
        const hasAura =
          fs.existsSync(path.join(p, '.aura-workspace')) ||
          fs.existsSync(path.join(p, '.aura'));
        if (hasAura) {
          console.log(`  - ${name} (${picocolors.green('Active')})`);
          console.log(`    Path: ${p}`);
          activeCount++;
        } else {
          missingCount++;
        }
      }
      if (activeCount === 0 && missingCount > 0) {
        console.log('  No active projects registered');
      }
      if (missingCount > 0) {
        console.log(
          picocolors.dim(
            `  - and ${missingCount} missing project(s). Run 'aura prune' to clean up.`,
          ),
        );
      }
    } else {
      console.log('  No projects registered');
    }
  }

  private static async displayWorkspaceInfo(): Promise<void> {
    const projectRoot = PathResolver.resolveProjectPath(process.cwd());

    if (!projectRoot) {
      console.log(`\n${'='.repeat(70)}`);
      console.log(
        picocolors.bold(picocolors.yellow('⚠️  No Workspace Detected')),
      );
      console.log('='.repeat(70));
      console.log(
        '\n  Not currently in an Aura workspace (no .aura-workspace directory found).',
      );
      console.log(
        `  To create a workspace, run: ${picocolors.bold('aura new <project_name>')}`,
      );
      console.log(`\n${'='.repeat(70)}`);
      return;
    }

    const workspacePath = PathResolver.environmentPath(projectRoot);
    if (!workspacePath) {
      console.log(picocolors.red('⚠️ Failed to resolve workspace path.'));
      return;
    }

    console.log(`\n${'='.repeat(70)}`);
    console.log(
      picocolors.bold(
        picocolors.green('📂 Workspace Information (Current Project)'),
      ),
    );
    console.log('='.repeat(70));

    console.log(`\n${picocolors.bold('📍 Workspace:')}`);
    console.log(`  Workspace Root: ${projectRoot}`);
    console.log(`  ${path.basename(workspacePath)} Path: ${workspacePath}`);

    Info.displayWorkspaceConfig(workspacePath);
    Info.displayWorkspaceDatabase(workspacePath);
    Info.displayWorkspaceSkills(workspacePath);
    Info.displayWorkspaceTools(workspacePath);
    Info.displaySandboxConfig(workspacePath);
    await Info.displayGitBranch(workspacePath);

    console.log(`\n${'='.repeat(70)}`);
  }

  private static displayWorkspaceConfig(workspacePath: string): void {
    const workspaceCfgPath = PathResolver.resolveConfigPath(workspacePath);
    console.log(`\n${picocolors.bold('⚙️ Workspace Configuration:')}`);
    if (!workspaceCfgPath || !fs.existsSync(workspaceCfgPath)) {
      console.log('  No workspace-specific config (using global defaults)');
      return;
    }

    try {
      const cfg = yaml.parse(fs.readFileSync(workspaceCfgPath, 'utf-8')) || {};
      const llmCfg = cfg.llm || {};
      if (llmCfg.provider) {
        console.log(
          `  LLM Provider: ${picocolors.yellow(`${llmCfg.provider} (workspace override)`)}`,
        );
        console.log(`  LLM Model: ${llmCfg.model || 'Inherit from global'}`);
        console.log(
          '  ⚠️  Note: Workspace config overrides global LLM settings',
        );
      } else {
        console.log(
          `  LLM Provider: ${picocolors.green('Inherit from global')}`,
        );
        console.log(`  LLM Model: ${picocolors.green('Inherit from global')}`);
      }
    } catch {}
  }

  private static displayWorkspaceDatabase(workspacePath: string): void {
    const workspaceDbPath = PathResolver.sessionDbPath(workspacePath);
    console.log(`\n${picocolors.bold('💾 Workspace Database:')}`);
    if (!fs.existsSync(workspaceDbPath)) {
      console.log('  Not yet initialized');
      return;
    }

    const dbSize = fs.statSync(workspaceDbPath).size;
    console.log(`  Path: ${workspaceDbPath}`);
    console.log(
      `  Size: ${dbSize > 1024 ? `${(dbSize / 1024.0).toFixed(1)} KB` : `${dbSize} B`}`,
    );
  }

  private static displayWorkspaceSkills(workspacePath: string): void {
    const workspaceRoot = path.dirname(workspacePath);
    const skillPaths = [
      path.join(workspaceRoot, 'skills'),
      path.join(workspacePath, 'skills'),
    ];

    const workspaceSkills: string[] = [];
    for (const dir of skillPaths) {
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
      fs.readdirSync(dir).forEach((file) => {
        if (
          !file.startsWith('.') &&
          fs.statSync(path.join(dir, file)).isDirectory()
        ) {
          workspaceSkills.push(file);
        }
      });
    }

    const uniqueSkills = Array.from(new Set(workspaceSkills));
    if (uniqueSkills.length === 0) return;

    console.log(`\n${picocolors.bold('🎨 Workspace Skills:')}`);
    console.log(`  ${uniqueSkills.length} skills installed`);
    console.log(`  Skills: ${uniqueSkills.join(', ')}`);
  }

  private static displayWorkspaceTools(workspacePath: string): void {
    const workspaceRoot = path.dirname(workspacePath);
    const toolPaths = [
      path.join(workspaceRoot, 'tools'),
      path.join(workspacePath, 'tools'),
    ];

    const workspaceTools: string[] = [];
    for (const dir of toolPaths) {
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
      fs.readdirSync(dir).forEach((file) => {
        if (
          !file.startsWith('.') &&
          fs.statSync(path.join(dir, file)).isDirectory()
        ) {
          workspaceTools.push(file);
        }
      });
    }

    const uniqueTools = Array.from(new Set(workspaceTools));
    if (uniqueTools.length === 0) return;

    console.log(`\n${picocolors.bold('🔧 Workspace Tools:')}`);
    console.log(`  ${uniqueTools.length} tools configured`);
  }

  private static displaySandboxConfig(workspacePath: string): void {
    const sandboxDockerfile = path.join(workspacePath, 'Dockerfile.sandbox');
    const sandboxWrapper = path.join(workspacePath, 'sandbox-wrapper.sh');
    console.log(`\n${picocolors.bold('🐳 Sandbox Configuration:')}`);
    console.log(
      `  Dockerfile.sandbox: ${fs.existsSync(sandboxDockerfile) ? picocolors.green('Exists') : picocolors.red('Not found')}`,
    );
    console.log(
      `  Sandbox Wrapper: ${fs.existsSync(sandboxWrapper) ? picocolors.green('Exists') : picocolors.yellow('Not found')}`,
    );
  }

  private static async displayGitBranch(workspacePath: string): Promise<void> {
    try {
      const { stdout } = await execa('git', ['branch', '--show-current'], {
        cwd: workspacePath,
      });
      const branch = stdout.trim();
      console.log(`\n${picocolors.bold('🌿 Agent Profile:')}`);
      console.log(`  Git Branch: ${branch || 'HEAD detached'}`);
    } catch {}
  }

  private static getEnvVarName(provider: string): string | null {
    if (!provider || provider.trim().length === 0) return null;
    return `${provider.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`;
  }
}
