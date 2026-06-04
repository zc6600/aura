import picocolors from 'picocolors';
import * as PathResolver from '../../utils/pathResolver.js';
import * as GlobalConfig from '../../utils/globalConfig.js';
import * as UI from '../ui.js';

export class Branch {
  public static async run(profileName?: string): Promise<void> {
    const auraDir = this.ensureWorkspace();

    if (!profileName) {
      await this.listBranches(auraDir);
    } else {
      await this.switchOrCreateBranch(auraDir, profileName);
    }
  }

  private static async listBranches(auraDir: string): Promise<void> {
    const res = await GlobalConfig.gitRun(auraDir, 'branch');
    if (res.success) {
      console.log('Customized Agent Profiles (Branches):');
      console.log('-'.repeat(60));
      console.log(res.stdout);
      console.log('-'.repeat(60));
    } else {
      console.error(picocolors.red(`Failed to list agent profiles: ${res.stderr}`));
    }
  }

  private static async switchOrCreateBranch(auraDir: string, profileName: string): Promise<void> {
    const res = await GlobalConfig.gitRun(auraDir, 'branch', '--list', profileName);
    const exists = res.success && res.stdout.trim().length > 0;

    if (exists) {
      await this.switchBranch(auraDir, profileName);
    } else {
      await this.promptCreateBranch(auraDir, profileName);
    }
  }

  private static async switchBranch(auraDir: string, profileName: string): Promise<void> {
    const checkoutRes = await GlobalConfig.gitRun(auraDir, 'checkout', profileName);
    if (checkoutRes.success) {
      console.log(picocolors.green(`Successfully switched active agent profile to '${profileName}'!`));
    } else {
      console.error(picocolors.red(`Failed to switch agent profile:\n${checkoutRes.stderr}`));
    }
  }

  private static async promptCreateBranch(auraDir: string, profileName: string): Promise<void> {
    console.log(`❓ Agent profile '${profileName}' does not exist.`);
    const answer = await UI.confirm('   Do you want to create a new profile from the current active?');
    if (answer) {
      await this.createBranch(auraDir, profileName);
    } else {
      console.log('Cancelled.');
    }
  }

  private static async createBranch(auraDir: string, profileName: string): Promise<void> {
    const createRes = await GlobalConfig.gitRun(auraDir, 'checkout', '-b', profileName);
    if (createRes.success) {
      console.log(picocolors.green(`Successfully created and switched to new agent profile '${profileName}'!`));
    } else {
      console.error(picocolors.red(`Failed to create agent profile:\n${createRes.stderr}`));
    }
  }

  private static ensureWorkspace(): string {
    try {
      return PathResolver.ensureWorkspace(process.cwd());
    } catch {
      console.error(picocolors.red('⛔️ Error: Not in an Aura workspace.'));
      process.exit(1);
    }
  }
}
