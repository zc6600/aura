import { execa } from 'execa';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Template } from '../../src/cli/commands/template.js';
import { Update } from '../../src/cli/commands/update.js';
import { CliError } from '../../src/cli/ui.js';

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

describe('Update.framework', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(Template, 'sync').mockResolvedValue(undefined);

    vi.mocked(execa).mockImplementation((async (
      command: string,
      args?: string[],
    ) => {
      if (command === 'git' && args?.[0] === 'branch') {
        return { stdout: 'main\n', stderr: '', exitCode: 0 } as any;
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    }) as any);
  });

  it('merges the current remote branch by default', async () => {
    await Update.framework();

    expect(execa).toHaveBeenCalledWith(
      'git',
      ['merge', 'origin/main'],
      expect.objectContaining({ cwd: expect.any(String) }),
    );
    expect(execa).not.toHaveBeenCalledWith(
      'git',
      ['reset', '--hard', 'origin/main'],
      expect.anything(),
    );
    expect(Template.sync).toHaveBeenCalled();
  });

  it('hard-resets to the current remote branch when force is enabled', async () => {
    await Update.framework({ force: true });

    expect(execa).toHaveBeenCalledWith(
      'git',
      ['reset', '--hard', 'origin/main'],
      expect.objectContaining({ cwd: expect.any(String) }),
    );
    expect(execa).not.toHaveBeenCalledWith(
      'git',
      ['merge', 'origin/main'],
      expect.anything(),
    );
    expect(Template.sync).toHaveBeenCalled();
  });

  describe('with uncommitted changes in the source checkout', () => {
    beforeEach(() => {
      vi.mocked(execa).mockImplementation((async (
        command: string,
        args?: string[],
      ) => {
        if (command === 'git' && args?.[0] === 'branch') {
          return { stdout: 'main\n', stderr: '', exitCode: 0 } as any;
        }
        if (command === 'git' && args?.[0] === 'status') {
          return {
            stdout: ' M src/some/file.ts\n?? scratch.txt\n',
            stderr: '',
            exitCode: 0,
          } as any;
        }
        return { stdout: '', stderr: '', exitCode: 0 } as any;
      }) as any);
    });

    it('refuses to reset/merge without --force, and never touches git or npm', async () => {
      await expect(Update.framework()).rejects.toThrow(CliError);

      expect(execa).not.toHaveBeenCalledWith(
        'git',
        ['merge', 'origin/main'],
        expect.anything(),
      );
      expect(execa).not.toHaveBeenCalledWith(
        'git',
        ['reset', '--hard', 'origin/main'],
        expect.anything(),
      );
      expect(execa).not.toHaveBeenCalledWith(
        'npm',
        expect.anything(),
        expect.anything(),
      );
      expect(Template.sync).not.toHaveBeenCalled();
    });

    it('still hard-resets (discarding local changes) when --force is passed', async () => {
      await Update.framework({ force: true });

      expect(execa).toHaveBeenCalledWith(
        'git',
        ['reset', '--hard', 'origin/main'],
        expect.objectContaining({ cwd: expect.any(String) }),
      );
      expect(Template.sync).toHaveBeenCalled();
    });
  });
});
