import picocolors from 'picocolors';
import * as GlobalConfig from '../../utils/globalConfig.js';
import * as PathResolver from '../../utils/pathResolver.js';
import * as UI from '../ui.js';

export const Branch = {
  async run(profileName?: string): Promise<void> {
    const auraDir = Branch.ensureWorkspace();

    if (!profileName) {
      await Branch.listBranches(auraDir);
    } else {
      await Branch.switchOrCreateBranch(auraDir, profileName);
    }
  },

  async listBranches(auraDir: string): Promise<void> {
    const res = await GlobalConfig.gitRun(auraDir, 'branch');
    if (res.success) {
      console.log('Customized Agent Profiles (Branches):');
      console.log('-'.repeat(60));
      const lines = res.stdout.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        if (line.startsWith('*')) {
          const name = line.substring(1).trim();
          console.log(
            `  ${picocolors.green('●')} ${picocolors.green(picocolors.bold(name))} ${picocolors.dim('(active)')}`,
          );
        } else {
          const name = line.trim();
          console.log(`    ${name}`);
        }
      }
      console.log('-'.repeat(60));
    } else {
      console.error(
        picocolors.red(`Failed to list agent profiles: ${res.stderr}`),
      );
    }
  },

  async switchOrCreateBranch(
    auraDir: string,
    profileName: string,
  ): Promise<void> {
    const res = await GlobalConfig.gitRun(
      auraDir,
      'branch',
      '--list',
      profileName,
    );
    const exists = res.success && res.stdout.trim().length > 0;

    if (exists) {
      await Branch.switchBranch(auraDir, profileName);
    } else {
      await Branch.promptCreateBranch(auraDir, profileName);
    }
  },

  async switchBranch(auraDir: string, profileName: string): Promise<void> {
    const checkoutRes = await GlobalConfig.gitRun(
      auraDir,
      'checkout',
      profileName,
    );
    if (checkoutRes.success) {
      console.log(
        picocolors.green(
          `Successfully switched active agent profile to '${profileName}'!`,
        ),
      );
    } else {
      console.error(
        picocolors.red(
          `Failed to switch agent profile:\n${checkoutRes.stderr}`,
        ),
      );
    }
  },

  async promptCreateBranch(
    auraDir: string,
    profileName: string,
  ): Promise<void> {
    console.log(`❓ Agent profile '${profileName}' does not exist.`);
    const answer = await UI.confirm(
      '   Do you want to create a new profile from the current active?',
    );
    if (answer) {
      await Branch.createBranch(auraDir, profileName);
    } else {
      console.log('Cancelled.');
    }
  },

  async createBranch(auraDir: string, profileName: string): Promise<void> {
    const createRes = await GlobalConfig.gitRun(
      auraDir,
      'checkout',
      '-b',
      profileName,
    );
    if (createRes.success) {
      console.log(
        picocolors.green(
          `Successfully created and switched to new agent profile '${profileName}'!`,
        ),
      );
    } else {
      console.error(
        picocolors.red(`Failed to create agent profile:\n${createRes.stderr}`),
      );
    }
  },

  ensureWorkspace(): string {
    try {
      return PathResolver.ensureWorkspace(process.cwd());
    } catch {
      throw new UI.WorkspaceError('Not in an Aura workspace.');
    }
  },
};
