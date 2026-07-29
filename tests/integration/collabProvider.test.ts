import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextBase } from '../../src/core/context/base.js';
import { CollabProvider } from '../../src/core/context/providers/collabProvider.js';

function writeJsonl(filePath: string, entries: Record<string, unknown>[]) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`,
  );
}

describe('CollabProvider (mailbox + groupchat)', () => {
  let projectPath: string;
  let busDir: string;

  beforeEach(() => {
    projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-temp-collab-'));
    busDir = path.join(
      projectPath,
      'state',
      'sessions',
      'default',
      'bus',
    );
  });

  afterEach(() => {
    if (fs.existsSync(projectPath)) {
      fs.rmSync(projectPath, { recursive: true, force: true });
    }
  });

  it('surfaces mailbox threads the current agent is a party to, and skips others', () => {
    writeJsonl(path.join(busDir, 'mailbox', 'data-scientist--software-engineer.jsonl'), [
      {
        id: '1',
        from: 'data-scientist',
        to: 'software-engineer',
        at: '2026-07-29T10:00:00',
        content: 'ETL 里有异常值，能查一下吗？',
      },
      {
        id: '2',
        from: 'software-engineer',
        to: 'data-scientist',
        at: '2026-07-29T10:05:00',
        content: '是时区转换的 bug，已修。',
        reply_to: '1',
      },
    ]);
    writeJsonl(path.join(busDir, 'mailbox', 'pm--software-engineer.jsonl'), [
      {
        id: '3',
        from: 'pm',
        to: 'software-engineer',
        at: '2026-07-29T09:00:00',
        content: '周五能发布吗？',
      },
    ]);

    const provider = new CollabProvider(projectPath, {
      agentId: 'data-scientist',
    });
    const out = provider.provide();

    expect(out).toContain('Agent Mailbox');
    expect(out).toContain('ETL 里有异常值');
    expect(out).toContain('是时区转换的 bug');
    expect(out).not.toContain('周五能发布吗');
  });

  it('marks replies distinctly from original letters', () => {
    writeJsonl(path.join(busDir, 'mailbox', 'a--b.jsonl'), [
      { id: '1', from: 'a', to: 'b', at: 't1', content: 'original' },
      {
        id: '2',
        from: 'b',
        to: 'a',
        at: 't2',
        content: 'the reply',
        reply_to: '1',
      },
    ]);

    const provider = new CollabProvider(projectPath, { agentId: 'a' });
    const out = provider.provide();

    const lines = (out || '').split('\n');
    const replyLine = lines.find((l) => l.includes('the reply'));
    const originalLine = lines.find((l) => l.includes(': original'));
    expect(replyLine).toContain('(reply)');
    expect(originalLine).not.toContain('(reply)');
  });

  it('surfaces group chat channels with mentions', () => {
    writeJsonl(path.join(busDir, 'groupchat', 'release.jsonl'), [
      {
        id: '1',
        from: 'pm',
        channel: 'release',
        at: '2026-07-29T09:00:00',
        content: '本周五发布，谁负责回归测试？',
      },
      {
        id: '2',
        from: 'software-engineer',
        channel: 'release',
        at: '2026-07-29T09:05:00',
        content: '我来。',
        mentions: ['pm', 'data-scientist'],
      },
    ]);

    const provider = new CollabProvider(projectPath, { agentId: 'anyone' });
    const out = provider.provide();

    expect(out).toContain('Group Chat Channels');
    expect(out).toContain('#release');
    expect(out).toContain('本周五发布');
    expect(out).toContain('(@pm, @data-scientist)');
  });

  it('caps output to the most recent maxMessages per thread/channel', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      from: 'a',
      to: 'b',
      at: `t${i}`,
      content: `msg-${i}`,
    }));
    writeJsonl(path.join(busDir, 'mailbox', 'a--b.jsonl'), many);

    const provider = new CollabProvider(projectPath, {
      agentId: 'a',
      maxMessages: 3,
    });
    const out = provider.provide() || '';

    expect(out).toContain('msg-9');
    expect(out).toContain('msg-8');
    expect(out).toContain('msg-7');
    expect(out).not.toContain('msg-6');
    expect(out).not.toContain('msg-0');
  });

  it('returns null when there is nothing addressed to this agent', () => {
    const provider = new CollabProvider(projectPath, { agentId: 'nobody' });
    expect(provider.provide()).toBeNull();
  });

  it('skips malformed JSON lines instead of throwing', () => {
    fs.mkdirSync(path.join(busDir, 'mailbox'), { recursive: true });
    fs.writeFileSync(
      path.join(busDir, 'mailbox', 'a--b.jsonl'),
      '{"id":"1","from":"a","to":"b","at":"t1","content":"ok"}\nnot json\n',
    );

    const provider = new CollabProvider(projectPath, { agentId: 'a' });
    const out = provider.provide();
    expect(out).toContain('ok');
  });

  it('is wired into ContextBase.buildEnvironmentContent()', () => {
    writeJsonl(path.join(busDir, 'groupchat', 'general.jsonl'), [
      {
        id: '1',
        from: 'data-scientist',
        channel: 'general',
        at: 't1',
        content: 'hello from the wired-in test',
      },
    ]);

    const base = new ContextBase(projectPath, null as any, {
      agentId: 'data-scientist',
    });
    const out = base.buildEnvironmentContent();

    expect(out).toContain('hello from the wired-in test');
  });
});
