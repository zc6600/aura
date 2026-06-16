import fs from 'node:fs';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import yaml from 'yaml';
import { SessionManager } from '../../../src/core/memory/sessionManager.js';
import { SQLiteStore } from '../../../src/core/memory/sqliteStore.js';
import {
  auraBinPath,
  createSystemWorkspace,
  requireSystemLlmConfig,
  runAura,
  runSystemTests,
  tsxLoaderPath,
  type SystemWorkspace,
} from '../utils/systemHarness.js';

const describeSystem = runSystemTests ? describe : describe.skip;

describeSystem('System interactive agent shell', { timeout: 240_000 }, () => {
  let workspace: SystemWorkspace;

  beforeEach(async () => {
    workspace = await createSystemWorkspace(
      'agent-interactive',
      requireSystemLlmConfig(),
    );
  });

  afterEach(async () => {
    await workspace.cleanup();
  });

  function startAgentShell(args: string[] = []) {
    return execa(
      process.execPath,
      ['--import', tsxLoaderPath, auraBinPath, 'agent', ...args],
      {
        cwd: workspace.root,
        stdin: 'pipe',
        reject: false,
        timeout: 180_000,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          AURA_SILENCE_LLM_WARNINGS: '1',
          AURA_SILENCE_PLANNER_WARNINGS: '1',
          ...workspace.env,
        },
      },
    );
  }

  function watchShell(child: ReturnType<typeof startAgentShell>) {
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    const combined = () => `${stdout}${stderr}`;

    const waitForOutput = async (
      matcher: string | RegExp,
      timeoutMs = 60_000,
    ): Promise<string> => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const current = combined();
        const matched =
          typeof matcher === 'string'
            ? current.includes(matcher)
            : matcher.test(current);
        if (matched) {
          return current;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      throw new Error(
        `Timed out waiting for ${String(matcher)}.\nOutput:\n${combined()}`,
      );
    };

    return {
      waitForOutput,
      combined,
    };
  }

  async function waitForCondition(
    predicate: () => boolean,
    timeoutMs = 60_000,
    description = 'condition',
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (predicate()) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    throw new Error(`Timed out waiting for ${description}.`);
  }

  async function settleInteractiveShell(
    child: ReturnType<typeof startAgentShell>,
    graceMs = 5_000,
  ): Promise<void> {
    const exitWithinGrace = child.then(
      () => true,
      () => true,
    );
    const settled = await Promise.race([
      exitWithinGrace,
      new Promise<false>((resolve) => setTimeout(() => resolve(false), graceMs)),
    ]);

    if (!settled) {
      child.kill('SIGTERM');
      await child.catch(() => undefined);
    }
  }

  it('answers a prompt through the daemon-backed interactive shell', async () => {
    const token = `AURA_AGENT_INTERACTIVE_DAEMON_${Date.now()}`;
    const child = startAgentShell();
    child.stdin?.write(
      `Reply with only this exact token and do not call tools: ${token}\n`,
    );
    child.stdin?.write('/exit\n');
    child.stdin?.end();

    const res = await child;
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('[Daemon]');
    expect(res.stdout).toContain(token);
  });

  it('answers a prompt through the local no-daemon interactive shell', async () => {
    const token = `AURA_AGENT_INTERACTIVE_LOCAL_${Date.now()}`;
    const child = startAgentShell(['--no-daemon']);
    child.stdin?.write(
      `Reply with only this exact token and do not call tools: ${token}\n`,
    );
    child.stdin?.write('/exit\n');
    child.stdin?.end();

    const res = await child;
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('[Local]');
    expect(res.stdout).toContain(token);
  });

  it('remembers a token across interactive daemon turns in the same session', async () => {
    const token = `AURA_AGENT_INTERACTIVE_MEMORY_${Date.now()}`;
    const first = startAgentShell();
    const firstShell = watchShell(first);
    await firstShell.waitForOutput('[Daemon]');
    first.stdin?.write(
      `Remember this token for the next turn: ${token}. Reply with only STORED and do not repeat the token.\n`,
    );
    first.stdin?.write('/exit\n');
    first.stdin?.end();

    const firstResult = await first;
    expect(firstResult.exitCode).toBe(0);

    const second = startAgentShell();
    const secondShell = watchShell(second);
    await secondShell.waitForOutput('[Daemon]');
    second.stdin?.write(
      'What token did I ask you to remember? Reply with only the token and do not call tools.\n',
    );
    second.stdin?.write('/exit\n');
    second.stdin?.end();

    const secondResult = await second;
    expect(secondResult.exitCode).toBe(0);
    expect(secondShell.combined()).toContain(token);
  });

  it('prompts for confirmation before a dangerous tool in the interactive daemon shell', async () => {
    const rawConfig = yaml.parse(fs.readFileSync(workspace.configPath, 'utf-8'));
    rawConfig.security = {
      ...(rawConfig.security || {}),
      confirm_dangerous_tools: true,
    };
    fs.writeFileSync(workspace.configPath, yaml.stringify(rawConfig), 'utf-8');

    const token = `AURA_AGENT_INTERACTIVE_CONFIRM_${Date.now()}`;
    const outputFile = 'interactive-confirm.txt';
    const outputPath = `${workspace.root}/${outputFile}`;
    const child = startAgentShell();
    const shell = watchShell(child);

    await shell.waitForOutput('[Daemon]');

    child.stdin?.write('/auto off\n');
    await shell.waitForOutput('Auto mode: OFF', 20_000);

    child.stdin?.write(
      [
        `Use the write_file tool to create ${outputFile}.`,
        `The file content must contain exactly this token: ${token}.`,
        'After the file is written, finish briefly.',
      ].join(' ') + '\n',
    );

    await shell.waitForOutput(
      /DANGEROUS TOOL: write_file\. Execute\? \[y\/N\]/,
      120_000,
    );

    child.stdin?.write('y\n');

    await waitForCondition(
      () => fs.existsSync(outputPath),
      120_000,
      `${outputFile} to be created`,
    );

    expect(fs.readFileSync(outputPath, 'utf-8')).toContain(token);

    child.stdin?.write('/exit\n');
    child.stdin?.end();

    const res = await child;
    expect(res.exitCode).toBe(0);
    expect(shell.combined()).toContain('DANGEROUS TOOL: write_file. Execute?');
  });

  it('does not execute a dangerous tool when confirmation is rejected in the interactive daemon shell', async () => {
    const rawConfig = yaml.parse(fs.readFileSync(workspace.configPath, 'utf-8'));
    rawConfig.security = {
      ...(rawConfig.security || {}),
      confirm_dangerous_tools: true,
    };
    fs.writeFileSync(workspace.configPath, yaml.stringify(rawConfig), 'utf-8');

    const token = `AURA_AGENT_INTERACTIVE_DENIED_${Date.now()}`;
    const outputFile = 'interactive-denied.txt';
    const outputPath = `${workspace.root}/${outputFile}`;
    const child = startAgentShell();
    const shell = watchShell(child);

    await shell.waitForOutput('[Daemon]');

    child.stdin?.write('/auto off\n');
    await shell.waitForOutput('Auto mode: OFF', 20_000);

    child.stdin?.write(
      [
        `Use the write_file tool to create ${outputFile}.`,
        `The file content must contain exactly this token: ${token}.`,
        'After the tool attempt, finish briefly.',
      ].join(' ') + '\n',
    );

    await shell.waitForOutput(
      /DANGEROUS TOOL: write_file\. Execute\? \[y\/N\]/,
      120_000,
    );

    child.stdin?.write('n\n');
    await new Promise((resolve) => setTimeout(resolve, 1_000));

    child.stdin?.write('/exit\n');
    child.stdin?.end();
    await settleInteractiveShell(child);
    expect(fs.existsSync(outputPath)).toBe(false);
    expect(shell.combined()).toContain('DANGEROUS TOOL: write_file. Execute?');
  });

  it('keeps remembered content isolated when a different session is activated before the next interactive shell', async () => {
    const token = `AURA_AGENT_INTERACTIVE_ISOLATED_${Date.now()}`;
    const isolatedSession = 'interactive_isolated';
    const sessionMgr = new SessionManager(workspace.root);
    if (!sessionMgr.exists(isolatedSession)) {
      sessionMgr.create(isolatedSession);
    }

    const first = startAgentShell();
    const firstShell = watchShell(first);
    await firstShell.waitForOutput('[Daemon]');
    first.stdin?.write(
      `Remember this token for later in this session only: ${token}. Reply with only STORED.\n`,
    );
    first.stdin?.write('/exit\n');
    first.stdin?.end();
    const firstResult = await first;
    expect(firstResult.exitCode).toBe(0);

    const switched = await runAura(workspace, [
      'session',
      'switch',
      isolatedSession,
    ]);
    expect(switched.exitCode).toBe(0);

    const second = startAgentShell();
    const secondShell = watchShell(second);
    await secondShell.waitForOutput('[Daemon]');
    second.stdin?.write(
      'What token did I ask you to remember earlier? If this session has no token, reply with UNKNOWN only.\n',
    );
    second.stdin?.write('/exit\n');
    second.stdin?.end();

    const secondResult = await second;
    expect(secondResult.exitCode).toBe(0);

    const sessions = sessionMgr.list({ includeMissing: true });
    const isolatedDb = sessions.find((item) => item.name === isolatedSession)
      ?.db_path;

    expect(isolatedDb).toBeTruthy();
    const isolatedStore = new SQLiteStore({ dbPath: isolatedDb! });

    try {
      const isolatedPayload = isolatedStore
        .fetchEvents()
        .map((event) => JSON.stringify(event.payload))
        .join('\n');

      expect(isolatedPayload).not.toContain(token);
    } finally {
      isolatedStore.close();
    }
  });
});
