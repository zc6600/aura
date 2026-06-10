import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as PathResolver from '../../src/utils/pathResolver.js';

describe('PathResolver', () => {
  describe('validateSafePath', () => {
    it('should allow paths within the base directory', () => {
      const base = '/foo/bar';

      expect(PathResolver.validateSafePath('baz.txt', base)).toBe(
        '/foo/bar/baz.txt',
      );
      expect(PathResolver.validateSafePath('sub/baz.txt', base)).toBe(
        '/foo/bar/sub/baz.txt',
      );
      expect(PathResolver.validateSafePath('.', base)).toBe('/foo/bar');
    });

    it('should throw SecurityError for paths outside the base directory', () => {
      const base = '/foo/bar';

      expect(() => {
        PathResolver.validateSafePath('/outside.txt', base);
      }).toThrow(PathResolver.SecurityError);

      expect(() => {
        PathResolver.validateSafePath('../outside.txt', base);
      }).toThrow(PathResolver.SecurityError);

      expect(() => {
        PathResolver.validateSafePath('../barbaz/file.txt', base);
      }).toThrow(PathResolver.SecurityError);
    });

    it('should correctly allow paths to non-existent files under a symlinked base directory', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-test-'));
      const realDir = path.join(tmpDir, 'real');
      fs.mkdirSync(realDir);

      const symlinkDir = path.join(tmpDir, 'symlink');
      fs.symlinkSync(realDir, symlinkDir);

      try {
        const nonExistentTarget = 'new-file.txt';
        const result = PathResolver.validateSafePath(
          nonExistentTarget,
          symlinkDir,
        );

        expect(result).toBe(
          path.join(fs.realpathSync(realDir), nonExistentTarget),
        );

        expect(() => {
          PathResolver.validateSafePath('../../escaped.txt', symlinkDir);
        }).toThrow(PathResolver.SecurityError);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('sanitizeSessionName', () => {
    it('should return default if no name is provided', () => {
      expect(PathResolver.sanitizeSessionName()).toBe('default');
      expect(PathResolver.sanitizeSessionName('')).toBe('default');
    });

    it('should allow alphanumeric session names', () => {
      expect(PathResolver.sanitizeSessionName('session123')).toBe('session123');
      expect(PathResolver.sanitizeSessionName('session-name')).toBe(
        'session-name',
      );
      expect(PathResolver.sanitizeSessionName('session_name')).toBe(
        'session_name',
      );
    });

    it('should throw ArgumentError for invalid names', () => {
      expect(() => {
        PathResolver.sanitizeSessionName('../evil');
      }).toThrow(PathResolver.ArgumentError);

      expect(() => {
        PathResolver.sanitizeSessionName('session/name');
      }).toThrow(PathResolver.ArgumentError);

      expect(() => {
        PathResolver.sanitizeSessionName('-invalid');
      }).toThrow(PathResolver.ArgumentError);

      expect(() => {
        PathResolver.sanitizeSessionName('a'.repeat(65));
      }).toThrow(PathResolver.ArgumentError);
    });
  });

  describe('validatePort', () => {
    it('should validate and parse correct ports', () => {
      expect(PathResolver.validatePort(3000)).toBe(3000);
      expect(PathResolver.validatePort('8080')).toBe(8080);
    });

    it('should throw ArgumentError for out of bounds ports', () => {
      expect(() => PathResolver.validatePort(-1)).toThrow(
        PathResolver.ArgumentError,
      );
      expect(() => PathResolver.validatePort(65536)).toThrow(
        PathResolver.ArgumentError,
      );
      expect(() => PathResolver.validatePort('invalid')).toThrow(
        PathResolver.ArgumentError,
      );
    });
  });

  describe('validateMaxSteps', () => {
    it('should validate correct steps count', () => {
      expect(PathResolver.validateMaxSteps(50)).toBe(50);
      expect(PathResolver.validateMaxSteps('100')).toBe(100);
    });

    it('should throw ArgumentError for invalid steps count', () => {
      expect(() => PathResolver.validateMaxSteps(0)).toThrow(
        PathResolver.ArgumentError,
      );
      expect(() => PathResolver.validateMaxSteps(-10)).toThrow(
        PathResolver.ArgumentError,
      );
      expect(() => PathResolver.validateMaxSteps(1001)).toThrow(
        PathResolver.ArgumentError,
      );
    });
  });
});
