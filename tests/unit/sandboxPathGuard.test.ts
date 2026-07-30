import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findOutsideSandboxPath } from '../../src/core/kernel/sandboxPathGuard.js';

describe('findOutsideSandboxPath', () => {
  const projectPath = path.resolve('/tmp/aura-project');

  it('returns null for commands with no path-like tokens', () => {
    expect(findOutsideSandboxPath('ls -la', projectPath)).toBeNull();
    expect(findOutsideSandboxPath('echo hello world', projectPath)).toBeNull();
  });

  it('returns null for paths inside the project', () => {
    expect(
      findOutsideSandboxPath('cat ./src/index.ts', projectPath),
    ).toBeNull();
    expect(
      findOutsideSandboxPath(`cat ${projectPath}/README.md`, projectPath),
    ).toBeNull();
    expect(findOutsideSandboxPath('cd subdir && ls', projectPath)).toBeNull();
  });

  it('flags absolute paths outside the project', () => {
    const violation = findOutsideSandboxPath(
      'rm -rf /Users/other/data',
      projectPath,
    );
    expect(violation).toBe('/Users/other/data');
  });

  it('flags parent-directory traversal', () => {
    const violation = findOutsideSandboxPath('cd .. && rm -rf *', projectPath);
    expect(violation).toBe(path.dirname(projectPath));
  });

  it('respects configured allow_paths', () => {
    const allowRoot = '/tmp/other-allowed';
    expect(
      findOutsideSandboxPath(`cat ${allowRoot}/file.txt`, projectPath, [
        allowRoot,
      ]),
    ).toBeNull();
  });

  it('still flags paths outside both project and allow_paths', () => {
    const violation = findOutsideSandboxPath(
      'cat /tmp/other-allowed/../secret',
      projectPath,
      ['/tmp/other-allowed'],
    );
    expect(violation).toBe('/tmp/secret');
  });
});
