import fs from 'node:fs';
import path from 'node:path';
import * as PathResolver from '../../../utils/pathResolver.js';

export interface CollabProviderOptions {
  envPath?: string;
  /** Overrides AURA_AGENT_ID / AURA_SESSION_NAME for whose mail/mentions to surface. */
  agentId?: string;
  /** Most-recent messages to surface per thread/channel. */
  maxMessages?: number;
}

interface StoredMessage {
  id?: string;
  from?: string;
  to?: string;
  channel?: string;
  at?: string;
  content?: string;
  reply_to?: string;
  mentions?: string[];
}

const JSONL_EXT = '.jsonl';

/**
 * Read-side counterpart to the `mailbox` and `groupchat` tools (see
 * `src/generators/aura/app/templates/tools/{mailbox,groupchat}/logic.py`).
 * Those tools append JSON-lines letters/messages into the shared bus dir;
 * this provider surfaces whatever is addressed to (or mentions) the current
 * agent so it shows up without the agent having to remember to poll.
 */
export class CollabProvider {
  private envPath: string;
  private agentId: string;
  private maxMessages: number;

  constructor(projectPath: string, options: CollabProviderOptions = {}) {
    const resolvedProjectPath = path.resolve(projectPath);
    this.envPath =
      options.envPath ||
      PathResolver.environmentPath(resolvedProjectPath) ||
      resolvedProjectPath;
    this.agentId =
      options.agentId ||
      process.env.AURA_AGENT_ID ||
      process.env.AURA_SESSION_NAME ||
      'default';
    this.maxMessages = options.maxMessages ?? 5;
  }

  public provide(): string | null {
    const sections: string[] = [];

    const mail = this.provideMailbox();
    if (mail) sections.push(mail);

    const chat = this.provideGroupChat();
    if (chat) sections.push(chat);

    return sections.length > 0 ? sections.join('\n\n') : null;
  }

  private resolveSessionName(): string {
    const envSession = process.env.AURA_SESSION_NAME;
    if (envSession && envSession.trim().length > 0) return envSession;

    const activeTxt = path.join(this.envPath, 'state', 'active_session.txt');
    if (fs.existsSync(activeTxt)) {
      try {
        const val = fs.readFileSync(activeTxt, 'utf-8').trim();
        if (val) return val;
      } catch {
        // fall through to default
      }
    }
    return 'default';
  }

  private busDir(subdir: string): string {
    return path.join(
      this.envPath,
      'state',
      'sessions',
      this.resolveSessionName(),
      'bus',
      subdir,
    );
  }

  private listJsonlFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    try {
      return fs.readdirSync(dir).filter((f) => f.endsWith(JSONL_EXT));
    } catch {
      return [];
    }
  }

  private readJsonl(filePath: string, limit: number): StoredMessage[] {
    if (!fs.existsSync(filePath)) return [];
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, 'utf-8');
    } catch {
      return [];
    }

    const messages: StoredMessage[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        messages.push(JSON.parse(trimmed));
      } catch {
        // Skip a malformed/partially-written line rather than fail the whole read.
      }
    }
    return limit > 0 ? messages.slice(-limit) : messages;
  }

  private provideMailbox(): string | null {
    const mailboxDir = this.busDir('mailbox');
    const files = this.listJsonlFiles(mailboxDir);
    if (files.length === 0) return null;

    const merged: StoredMessage[] = [];
    for (const fname of files) {
      const parties = fname.slice(0, -JSONL_EXT.length).split('--');
      if (!parties.includes(this.agentId)) continue;
      merged.push(...this.readJsonl(path.join(mailboxDir, fname), 0));
    }
    if (merged.length === 0) return null;

    merged.sort((a, b) => (a.at || '').localeCompare(b.at || ''));
    const recent = merged.slice(-this.maxMessages);

    const lines = recent.map((m) => {
      const tag = m.reply_to ? '(reply) ' : '';
      return `- ${tag}[${m.at}] @${m.from} → @${m.to}: ${m.content}`;
    });
    return `## Agent Mailbox (as "${this.agentId}")\n${lines.join('\n')}`;
  }

  private provideGroupChat(): string | null {
    const groupDir = this.busDir('groupchat');
    const files = this.listJsonlFiles(groupDir);
    if (files.length === 0) return null;

    const blocks: string[] = [];
    for (const fname of files.sort()) {
      const channel = fname.slice(0, -JSONL_EXT.length);
      const messages = this.readJsonl(
        path.join(groupDir, fname),
        this.maxMessages,
      );
      if (messages.length === 0) continue;

      const lines = messages.map((m) => {
        const mentions =
          m.mentions && m.mentions.length > 0
            ? ` (@${m.mentions.join(', @')})`
            : '';
        return `- [${m.at}] @${m.from}${mentions}: ${m.content}`;
      });
      blocks.push(`### #${channel}\n${lines.join('\n')}`);
    }
    if (blocks.length === 0) return null;

    return `## Group Chat Channels\n${blocks.join('\n\n')}`;
  }
}
