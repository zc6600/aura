import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as ConfigManager from '../../src/utils/configManager.js';

describe('ConfigManager', () => {
  const tempDir = path.resolve(__dirname, 'temp-test-config');

  beforeAll(() => {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('get and set', () => {
    it('should get nested values correctly', () => {
      const config = {
        llm: {
          provider: 'openai',
          temperature: 0.7
        }
      };

      expect(ConfigManager.get(config, 'llm.provider')).toBe('openai');
      expect(ConfigManager.get(config, 'llm.temperature')).toBe(0.7);
      expect(ConfigManager.get(config, 'llm.nonexistent')).toBeUndefined();
      expect(ConfigManager.get(config, 'invalid.key')).toBeUndefined();
    });

    it('should set and coerce nested values correctly', () => {
      const config: any = {};

      // String setting
      ConfigManager.set(config, 'llm.provider', 'anthropic');
      expect(config.llm.provider).toBe('anthropic');

      // Boolean coercion
      ConfigManager.set(config, 'llm.stream', 'true');
      expect(config.llm.stream).toBe(true);

      ConfigManager.set(config, 'llm.stream', 'false');
      expect(config.llm.stream).toBe(false);

      // Number coercion (integer)
      ConfigManager.set(config, 'llm.max_tokens', '4096');
      expect(config.llm.max_tokens).toBe(4096);

      // Float coercion
      ConfigManager.set(config, 'llm.temperature', '0.5');
      expect(config.llm.temperature).toBe(0.5);
    });
  });

  describe('load, write and fallback', () => {
    it('should write and load configuration files correctly', () => {
      const configPath = path.join(tempDir, 'config.yml');
      const testConfig = {
        project_name: 'test-agent',
        llm: {
          provider: 'openai'
        }
      };

      ConfigManager.write(configPath, testConfig);
      expect(fs.existsSync(configPath)).toBe(true);

      const loaded = ConfigManager.load(tempDir);
      expect(loaded.project_name).toBe('test-agent');
      expect(loaded.llm.provider).toBe('openai');
    });

    it('should load fallback configuration if primary is missing', () => {
      const primaryPath = path.join(tempDir, 'nonexistent');
      const fallbackDir = path.join(tempDir, 'fallback-dir');
      const fallbackPath = path.join(fallbackDir, 'config', 'config.yml');

      const testConfig = {
        project_name: 'fallback-agent'
      };

      ConfigManager.write(fallbackPath, testConfig);

      const loaded = ConfigManager.loadWithFallback(primaryPath, fallbackDir);
      expect(loaded.project_name).toBe('fallback-agent');
    });
  });
});
