import { execa } from 'execa';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Template } from '../../src/cli/commands/template.js';
import { Update } from '../../src/cli/commands/update.js';

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

describe('Update.framework', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(Template, 'sync').mockResolvedValue(undefined);

    vi.mocked(execa).mockImplementation((async (command: string, args?: string[]) => {
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
});
