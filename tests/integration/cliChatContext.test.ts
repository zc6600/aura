import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeWorkspaceInPlace } from '../../src/utils/workspaceInitializer.js';
import { rmRetry } from '../utils/rmRetry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const auraBinPath = path.resolve(__dirname, '../../src/bin/aura.ts');

describe('CLI Chat Context & Commands Integration', { timeout: 60000 }, () => {
  let tempWorkspace: string;

  beforeEach(async () => {
    // Create a temporary workspace directory
    tempWorkspace = path.resolve(__dirname, `temp-chat-context-${Date.now()}`);
    fs.mkdirSync(tempWorkspace, { recursive: true });

    // Initialize workspace directly in-process
    await initializeWorkspaceInPlace(tempWorkspace);
  });

  afterEach(async () => {
    if (fs.existsSync(tempWorkspace)) {
      await rmRetry(tempWorkspace);
    }
  });

  it('test_chat_context_empty', async () => {
    const res = await execa('npx', ['tsx', auraBinPath, 'chat', 'context'], {
      cwd: tempWorkspace,
    });
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain(
      "No conversation history found for session 'default'.",
    );
  });

  it('test_chat_context_populated', async () => {
    const sessionDir = path.join(
      tempWorkspace,
      '.aura-workspace',
      'state',
      'chat_sessions',
    );
    fs.mkdirSync(sessionDir, { recursive: true });
    const historyFile = path.join(sessionDir, 'default.json');

    const mockHistory = [
      { role: 'user', content: 'Hello there!' },
      { role: 'assistant', content: 'General Kenobi!' },
    ];
    fs.writeFileSync(historyFile, JSON.stringify(mockHistory, null, 2));

    const res = await execa('npx', ['tsx', auraBinPath, 'chat', 'context'], {
      cwd: tempWorkspace,
    });
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("Conversation history for session 'default':");
    expect(res.stdout).toContain('User');
    expect(res.stdout).toContain('Hello there!');
    expect(res.stdout).toContain('Assistant');
    expect(res.stdout).toContain('General Kenobi!');
  });

  it('test_chat_context_custom_session', async () => {
    const sessionDir = path.join(
      tempWorkspace,
      '.aura-workspace',
      'state',
      'chat_sessions',
    );
    fs.mkdirSync(sessionDir, { recursive: true });
    const historyFile = path.join(sessionDir, 'my_session.json');

    const mockHistory = [
      { role: 'user', content: 'Is this a custom session?' },
      { role: 'assistant', content: 'Yes it is.' },
    ];
    fs.writeFileSync(historyFile, JSON.stringify(mockHistory, null, 2));

    // Try default session (should be empty)
    const resDefault = await execa(
      'npx',
      ['tsx', auraBinPath, 'chat', 'context'],
      {
        cwd: tempWorkspace,
      },
    );
    expect(resDefault.stdout).toContain(
      "No conversation history found for session 'default'.",
    );

    // Try custom session using --session
    const resCustom = await execa(
      'npx',
      ['tsx', auraBinPath, 'chat', 'context', '--session', 'my_session'],
      {
        cwd: tempWorkspace,
      },
    );
    expect(resCustom.exitCode).toBe(0);
    expect(resCustom.stdout).toContain(
      "Conversation history for session 'my_session':",
    );
    expect(resCustom.stdout).toContain('Is this a custom session?');
    expect(resCustom.stdout).toContain('Yes it is.');

    // Try custom session using -s
    const resCustomShort = await execa(
      'npx',
      ['tsx', auraBinPath, 'chat', 'context', '-s', 'my_session'],
      {
        cwd: tempWorkspace,
      },
    );
    expect(resCustomShort.exitCode).toBe(0);
    expect(resCustomShort.stdout).toContain(
      "Conversation history for session 'my_session':",
    );
  });

  it('test_chat_context_clear', async () => {
    const sessionDir = path.join(
      tempWorkspace,
      '.aura-workspace',
      'state',
      'chat_sessions',
    );
    fs.mkdirSync(sessionDir, { recursive: true });
    const historyFile = path.join(sessionDir, 'default.json');

    const mockHistory = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
    ];
    fs.writeFileSync(historyFile, JSON.stringify(mockHistory, null, 2));

    const res = await execa(
      'npx',
      ['tsx', auraBinPath, 'chat', 'context', '--clear'],
      {
        cwd: tempWorkspace,
      },
    );
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("Memory cleared for session 'default'.");
    expect(res.stdout).toContain(
      "No conversation history found for session 'default'.",
    );
    expect(fs.existsSync(historyFile)).toBe(false);
  });

  it('test_chat_loop_exit', async () => {
    const child = execa('npx', ['tsx', auraBinPath, 'chat'], {
      cwd: tempWorkspace,
      stdin: 'pipe',
    });

    child.stdin?.write('exit\n');
    const res = await child;
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('Pure chat session started');
    expect(res.stdout).toContain('Bye!');
  });

  it('test_chat_loop_clear', async () => {
    const sessionDir = path.join(
      tempWorkspace,
      '.aura-workspace',
      'state',
      'chat_sessions',
    );
    fs.mkdirSync(sessionDir, { recursive: true });
    const historyFile = path.join(sessionDir, 'default.json');
    fs.writeFileSync(
      historyFile,
      JSON.stringify([{ role: 'user', content: 'Hello' }], null, 2),
    );

    const child = execa('npx', ['tsx', auraBinPath, 'chat'], {
      cwd: tempWorkspace,
      stdin: 'pipe',
    });

    child.stdin?.write('clear\n');
    child.stdin?.write('exit\n');
    const res = await child;

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("Memory cleared for session 'default'.");
    expect(fs.existsSync(historyFile)).toBe(false);
  });

  it('test_chat_loop_context', async () => {
    const sessionDir = path.join(
      tempWorkspace,
      '.aura-workspace',
      'state',
      'chat_sessions',
    );
    fs.mkdirSync(sessionDir, { recursive: true });
    const historyFile = path.join(sessionDir, 'default.json');
    fs.writeFileSync(
      historyFile,
      JSON.stringify([{ role: 'user', content: 'Hello there!' }], null, 2),
    );

    const child = execa('npx', ['tsx', auraBinPath, 'chat'], {
      cwd: tempWorkspace,
      stdin: 'pipe',
    });

    child.stdin?.write('context\n');
    child.stdin?.write('exit\n');
    const res = await child;

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("Conversation history for session 'default':");
    expect(res.stdout).toContain('User');
    expect(res.stdout).toContain('Hello there!');
  });

  it('test_chat_loop_slash_exit', async () => {
    const child = execa('npx', ['tsx', auraBinPath, 'chat'], {
      cwd: tempWorkspace,
      stdin: 'pipe',
    });

    child.stdin?.write('/exit\n');
    const res = await child;
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('Bye!');
  });

  it('test_chat_loop_slash_clear', async () => {
    const sessionDir = path.join(
      tempWorkspace,
      '.aura-workspace',
      'state',
      'chat_sessions',
    );
    fs.mkdirSync(sessionDir, { recursive: true });
    const historyFile = path.join(sessionDir, 'default.json');
    fs.writeFileSync(
      historyFile,
      JSON.stringify([{ role: 'user', content: 'Hello' }], null, 2),
    );

    const child = execa('npx', ['tsx', auraBinPath, 'chat'], {
      cwd: tempWorkspace,
      stdin: 'pipe',
    });

    child.stdin?.write('/clear\n');
    child.stdin?.write('/exit\n');
    const res = await child;

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("Memory cleared for session 'default'.");
    expect(fs.existsSync(historyFile)).toBe(false);
  });

  it('test_chat_loop_slash_context', async () => {
    const sessionDir = path.join(
      tempWorkspace,
      '.aura-workspace',
      'state',
      'chat_sessions',
    );
    fs.mkdirSync(sessionDir, { recursive: true });
    const historyFile = path.join(sessionDir, 'default.json');
    fs.writeFileSync(
      historyFile,
      JSON.stringify([{ role: 'user', content: 'Hello there!' }], null, 2),
    );

    const child = execa('npx', ['tsx', auraBinPath, 'chat'], {
      cwd: tempWorkspace,
      stdin: 'pipe',
    });

    child.stdin?.write('/context\n');
    child.stdin?.write('/exit\n');
    const res = await child;

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("Conversation history for session 'default':");
    expect(res.stdout).toContain('Hello there!');
  });

  it('test_chat_loop_slash_model', async () => {
    const child = execa('npx', ['tsx', auraBinPath, 'chat'], {
      cwd: tempWorkspace,
      stdin: 'pipe',
    });

    child.stdin?.write('/model\n');
    child.stdin?.write('/model my_special_model\n');
    child.stdin?.write('/exit\n');
    const res = await child;

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('Current model');
    expect(res.stdout).toContain('Model switched to:');
    expect(res.stdout).toContain('my_special_model');
  });

  it('test_chat_loop_slash_provider', async () => {
    const child = execa('npx', ['tsx', auraBinPath, 'chat'], {
      cwd: tempWorkspace,
      stdin: 'pipe',
    });

    child.stdin?.write('/provider\n');
    child.stdin?.write('/provider local\n');
    child.stdin?.write('/exit\n');
    const res = await child;

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('Current provider');
    expect(res.stdout).toContain('Provider switched to:');
    expect(res.stdout).toContain('local');
  });

  it('test_chat_loop_slash_session', async () => {
    const child = execa('npx', ['tsx', auraBinPath, 'chat'], {
      cwd: tempWorkspace,
      stdin: 'pipe',
    });

    child.stdin?.write('/session\n');
    child.stdin?.write('/session user_info\n');
    child.stdin?.write('/exit\n');
    const res = await child;

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('Current session');
    expect(res.stdout).toContain('Switched to session:');
    expect(res.stdout).toContain('user_info');
  });

  it('test_chat_loop_slash_help', async () => {
    const child = execa('npx', ['tsx', auraBinPath, 'chat'], {
      cwd: tempWorkspace,
      stdin: 'pipe',
    });

    child.stdin?.write('/help\n');
    child.stdin?.write('/exit\n');
    const res = await child;

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('Available commands:');
    expect(res.stdout).toContain('/exit or /quit');
    expect(res.stdout).toContain('/clear');
    expect(res.stdout).toContain('/context');
    expect(res.stdout).toContain('/settings');
    expect(res.stdout).toContain('/undo');
  });

  it('test_chat_loop_slash_settings', async () => {
    const child = execa('npx', ['tsx', auraBinPath, 'chat'], {
      cwd: tempWorkspace,
      stdin: 'pipe',
    });

    child.stdin?.write('/settings\n');
    child.stdin?.write('/exit\n');
    const res = await child;

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('Current Chat Settings:');
    expect(res.stdout).toContain('Active Session:');
    expect(res.stdout).toContain('LLM Provider:');
  });

  it('test_chat_loop_slash_undo', async () => {
    const sessionDir = path.join(
      tempWorkspace,
      '.aura-workspace',
      'state',
      'chat_sessions',
    );
    fs.mkdirSync(sessionDir, { recursive: true });
    const historyFile = path.join(sessionDir, 'default.json');

    const mockHistory = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
    ];
    fs.writeFileSync(historyFile, JSON.stringify(mockHistory, null, 2));

    const child = execa('npx', ['tsx', auraBinPath, 'chat'], {
      cwd: tempWorkspace,
      stdin: 'pipe',
    });

    child.stdin?.write('/undo\n');
    child.stdin?.write('/exit\n');
    const res = await child;

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('Undid last turn.');

    const currentHistory = JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
    expect(currentHistory).toEqual([]);
  });
});
