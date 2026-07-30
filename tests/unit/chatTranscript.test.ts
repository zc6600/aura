import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importLegacyChatHistory } from '../../src/core/memory/legacyChatImport.js';
import { MemoryProvider } from '../../src/core/memory/provider.js';
import { MemoryRecorder } from '../../src/core/memory/recorder.js';
import { SQLiteStore } from '../../src/core/memory/sqliteStore.js';
import * as PathResolver from '../../src/utils/pathResolver.js';

describe('unified chat transcript', () => {
  let tempDir: string;
  let stateDir: string;
  let store: SQLiteStore;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-chat-transcript-'));
    stateDir = path.join(tempDir, 'state');
    store = new SQLiteStore({
      dbPath: path.join(stateDir, 'sessions', 'default.db'),
    });
  });

  afterEach(() => {
    try {
      store.close();
    } catch {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('MemoryProvider.toChatMessages', () => {
    it('rebuilds user and assistant turns in order', () => {
      const recorder = new MemoryRecorder(store);
      recorder.recordUser('hello');
      recorder.recordAssistant('hi there');
      recorder.recordUser('and again');
      recorder.recordAssistant('still here');

      expect(new MemoryProvider(store).toChatMessages()).toEqual([
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi there' },
        { role: 'user', content: 'and again' },
        { role: 'assistant', content: 'still here' },
      ]);
    });

    it('preserves long replies that toMarkdown would truncate', () => {
      const long = 'x'.repeat(5000);
      const recorder = new MemoryRecorder(store);
      recorder.recordUser('give me a long answer');
      recorder.recordAssistant(long);

      const messages = new MemoryProvider(store).toChatMessages();
      expect(messages.at(-1)?.content).toHaveLength(5000);
    });

    it('omits tool calls and their results', () => {
      const recorder = new MemoryRecorder(store);
      recorder.recordUser('build it');
      recorder.recordPlan({
        type: 'tool_call',
        tool: 'write_file',
        args: { path: 'a.txt' },
        summary: 'writing a file',
      } as never);
      recorder.recordExecution('write_file', { status: 'ok' });
      recorder.recordAssistant('done');

      expect(new MemoryProvider(store).toChatMessages()).toEqual([
        { role: 'user', content: 'build it' },
        { role: 'assistant', content: 'done' },
      ]);
    });

    it('merges consecutive same-role turns so providers do not reject them', () => {
      const recorder = new MemoryRecorder(store);
      recorder.recordUser('first ask');
      // An agent turn that ran tools but never spoke leaves two user events
      // adjacent in the log.
      recorder.recordUser('second ask');

      expect(new MemoryProvider(store).toChatMessages()).toEqual([
        { role: 'user', content: 'first ask\n\nsecond ask' },
      ]);
    });

    it('keeps the newest events when limited', () => {
      const recorder = new MemoryRecorder(store);
      for (let i = 0; i < 5; i++) {
        recorder.recordUser(`ask ${i}`);
        recorder.recordAssistant(`reply ${i}`);
      }

      const messages = new MemoryProvider(store).toChatMessages({ limit: 4 });
      expect(messages).toEqual([
        { role: 'user', content: 'ask 3' },
        { role: 'assistant', content: 'reply 3' },
        { role: 'user', content: 'ask 4' },
        { role: 'assistant', content: 'reply 4' },
      ]);
    });
  });

  describe('SQLiteStore.clearHistory', () => {
    it('drops the transcript but keeps tool variables', () => {
      const recorder = new MemoryRecorder(store);
      const id = recorder.recordUser('hello');
      recorder.recordAssistant('hi');
      recorder.recordSummary('a summary', id);
      store.setVariable('tool:read_file', 'ok');

      store.clearHistory();

      expect(store.countEvents()).toBe(0);
      expect(new MemoryProvider(store).toChatMessages()).toEqual([]);
      expect(store.fetchSummaries()).toEqual([]);
      expect(store.allVariables()).toEqual({ 'tool:read_file': 'ok' });
    });
  });

  describe('undoLastTurn over a chat turn', () => {
    it('removes the user message and its reply together', () => {
      const recorder = new MemoryRecorder(store);
      recorder.recordUser('keep me');
      recorder.recordAssistant('kept');
      recorder.recordUser('drop me');
      recorder.recordAssistant('dropped');

      expect(store.undoLastTurn()).toBe(true);
      expect(new MemoryProvider(store).toChatMessages()).toEqual([
        { role: 'user', content: 'keep me' },
        { role: 'assistant', content: 'kept' },
      ]);
    });
  });

  describe('importLegacyChatHistory', () => {
    const writeLegacy = (messages: unknown) => {
      const legacyDir = path.join(stateDir, 'chat_sessions');
      fs.mkdirSync(legacyDir, { recursive: true });
      const file = path.join(legacyDir, 'default.json');
      fs.writeFileSync(file, JSON.stringify(messages));
      return file;
    };

    it('imports a legacy transcript and retires the file', () => {
      const file = writeLegacy([
        { role: 'user', content: 'old question' },
        { role: 'assistant', content: 'old answer' },
      ]);

      const result = importLegacyChatHistory(store, stateDir, 'default');

      expect(result.imported).toBe(2);
      expect(new MemoryProvider(store).toChatMessages()).toEqual([
        { role: 'user', content: 'old question' },
        { role: 'assistant', content: 'old answer' },
      ]);
      expect(fs.existsSync(file)).toBe(false);
      expect(fs.existsSync(`${file}.migrated`)).toBe(true);
    });

    it('skips a session that already has events, leaving the file intact', () => {
      new MemoryRecorder(store).recordUser('existing turn');
      const file = writeLegacy([{ role: 'user', content: 'old question' }]);

      const result = importLegacyChatHistory(store, stateDir, 'default');

      expect(result.imported).toBe(0);
      expect(result.skippedReason).toBe('session-not-empty');
      expect(fs.existsSync(file)).toBe(true);
      expect(new MemoryProvider(store).toChatMessages()).toEqual([
        { role: 'user', content: 'existing turn' },
      ]);
    });

    it('leaves an unreadable file alone', () => {
      const legacyDir = path.join(stateDir, 'chat_sessions');
      fs.mkdirSync(legacyDir, { recursive: true });
      const file = path.join(legacyDir, 'default.json');
      fs.writeFileSync(file, 'not json at all');

      const result = importLegacyChatHistory(store, stateDir, 'default');

      expect(result.imported).toBe(0);
      expect(result.skippedReason).toBe('unreadable');
      expect(fs.existsSync(file)).toBe(true);
    });

    it('drops rows that are not user or assistant turns', () => {
      writeLegacy([
        { role: 'system', content: 'ignored' },
        { role: 'user', content: '   ' },
        { role: 'user', content: 'kept' },
      ]);

      const result = importLegacyChatHistory(store, stateDir, 'default');

      expect(result.imported).toBe(1);
      expect(new MemoryProvider(store).toChatMessages()).toEqual([
        { role: 'user', content: 'kept' },
      ]);
    });

    it('is a no-op when there is nothing to migrate', () => {
      expect(importLegacyChatHistory(store, stateDir, 'default')).toEqual({
        imported: 0,
      });
    });
  });

  describe('reserved session prefixes', () => {
    it('rejects user-supplied names that collide with Ralph scratch sessions', () => {
      expect(() =>
        PathResolver.assertSessionNameNotReserved('ralph_run_123'),
      ).toThrow(/reserved/i);
      expect(() =>
        PathResolver.assertSessionNameNotReserved('RALPH_debug'),
      ).toThrow(/reserved/i);
    });

    it('allows ordinary names, including ones merely containing the word', () => {
      expect(() =>
        PathResolver.assertSessionNameNotReserved('my_ralph_notes'),
      ).not.toThrow();
      expect(() =>
        PathResolver.assertSessionNameNotReserved('default'),
      ).not.toThrow();
    });

    it('still resolves runtime Ralph session paths', () => {
      // The runtime itself must keep working; the guard is only for humans.
      expect(PathResolver.sanitizeSessionName('ralph_run_abc_step_1')).toBe(
        'ralph_run_abc_step_1',
      );
    });
  });
});
