import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  configPath,
  register,
  registeredProjects,
  unregister,
} from '../../src/utils/projectRegistry.js';

describe('projectRegistry', () => {
  let tempDir: string;
  let customConfigPath: string;
  let originalEnvValue: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'aura-test-project-registry-'),
    );
    customConfigPath = path.join(tempDir, 'projects.yml');
    originalEnvValue = process.env.AURA_GLOBAL_PROJECTS_CONFIG_PATH;
    process.env.AURA_GLOBAL_PROJECTS_CONFIG_PATH = customConfigPath;
  });

  afterEach(() => {
    if (originalEnvValue === undefined) {
      delete process.env.AURA_GLOBAL_PROJECTS_CONFIG_PATH;
    } else {
      process.env.AURA_GLOBAL_PROJECTS_CONFIG_PATH = originalEnvValue;
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_e) {}
  });

  it('should resolve configPath from environment variable', () => {
    expect(configPath()).toBe(customConfigPath);
  });

  it('should fall back to default path if environment variable is not set', () => {
    delete process.env.AURA_GLOBAL_PROJECTS_CONFIG_PATH;
    const fallbackPath = configPath();
    expect(fallbackPath).toContain('.aura-framework');
    expect(fallbackPath).toContain('projects.yml');
  });

  it('should return empty object if config file does not exist', () => {
    expect(registeredProjects()).toEqual({});
  });

  it('should return empty object if yaml parsing fails', () => {
    fs.writeFileSync(customConfigPath, 'invalid: yml: content:', 'utf-8');
    expect(registeredProjects()).toEqual({});
  });

  it('should register a project and list it', () => {
    const projPath = path.join(tempDir, 'dummy-project');
    fs.mkdirSync(projPath, { recursive: true });

    register('my-proj', projPath);

    const projects = registeredProjects();
    expect(projects).toHaveProperty('my-proj');
    expect(projects['my-proj']).toBe(path.resolve(projPath));
  });

  it('should handle missing directory on register', () => {
    const deepPath = path.join(tempDir, 'nested/dir/projects.yml');
    process.env.AURA_GLOBAL_PROJECTS_CONFIG_PATH = deepPath;

    register('test-deep', '/some/path');
    const projects = registeredProjects();
    expect(projects).toEqual({ 'test-deep': '/some/path' });
  });

  it('should handle unregister on non-existent config', () => {
    expect(unregister('non-existent')).toBe(false);
  });

  it('should handle unregister for projects', () => {
    register('p1', '/path/1');
    register('p2', '/path/2');

    expect(unregister('p1')).toBe(true);
    expect(registeredProjects()).toEqual({ p2: '/path/2' });

    expect(unregister('p1')).toBe(false);
  });

  it('should handle corrupted YAML file on register and unregister', () => {
    // Write invalid yaml
    fs.writeFileSync(customConfigPath, 'this-is-not-valid-yaml:', 'utf-8');

    // Register should self-heal and write successfully
    register('recovered', '/recovered/path');
    expect(registeredProjects()).toEqual({ recovered: '/recovered/path' });

    // Corrupt it again
    fs.writeFileSync(customConfigPath, 'this-is-not-valid-yaml:', 'utf-8');
    // Unregister should fail gracefully
    expect(unregister('recovered')).toBe(false);
  });

  it('should handle read/parse failures gracefully in registeredProjects, register and unregister', () => {
    // Make customConfigPath a directory to cause readFileSync to throw EISDIR
    fs.mkdirSync(customConfigPath, { recursive: true });

    expect(registeredProjects()).toEqual({});
    expect(unregister('my-project')).toBe(false);
    expect(() => register('my-project', '/path')).toThrow();
  });

  describe('name collisions', () => {
    it('returns the same name unchanged when re-registering the same path', () => {
      const name1 = register('backend', '/repos/team-a/backend');
      const name2 = register('backend', '/repos/team-a/backend');

      expect(name1).toBe('backend');
      expect(name2).toBe('backend');
      expect(registeredProjects()).toEqual({
        backend: '/repos/team-a/backend',
      });
    });

    it('disambiguates instead of silently repointing an existing name to a different path', () => {
      const first = register('backend', '/repos/team-a/backend');
      const second = register('backend', '/repos/team-b/backend');

      expect(first).toBe('backend');
      expect(second).toBe('backend-2');
      expect(registeredProjects()).toEqual({
        backend: '/repos/team-a/backend',
        'backend-2': '/repos/team-b/backend',
      });
    });

    it('keeps incrementing the suffix past existing disambiguated names', () => {
      register('backend', '/repos/team-a/backend');
      register('backend', '/repos/team-b/backend'); // -> backend-2
      const third = register('backend', '/repos/team-c/backend');

      expect(third).toBe('backend-3');
      expect(registeredProjects()['backend-3']).toBe('/repos/team-c/backend');
    });
  });
});
