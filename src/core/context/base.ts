import * as path from 'node:path';
import type { Database } from 'better-sqlite3';
import * as ConfigManager from '../../utils/configManager.js';
import { type AuraConfig, parseAuraConfig } from '../../utils/configSchema.js';
import * as PathResolver from '../../utils/pathResolver.js';
import type { LSPManager } from '../ext/lsp/manager.js';
import {
  ContextEnvProvider,
  ContextMemory,
  ContextPayload,
  ContextPrompt,
} from './payload.js';
import { AnchorProvider } from './providers/anchorProvider.js';
import { BackgroundProcessProvider } from './providers/backgroundProcessProvider.js';
import { DirectiveProvider } from './providers/directiveProvider.js';
import { DirectoryTreeProvider } from './providers/directoryTreeProvider.js';
import { GardenProvider } from './providers/gardenProvider.js';
import { GlobalRulesProvider } from './providers/globalRulesProvider.js';
import { HintProvider } from './providers/hintProvider.js';
import { KnowledgeProvider } from './providers/knowledgeProvider.js';
import { LSPProvider } from './providers/lspProvider.js';
import { SkillProvider } from './providers/skillProvider.js';
import { StateProvider } from './providers/stateProvider.js';
import { TaskProvider } from './providers/taskProvider.js';
import { ToolProvider } from './providers/toolProvider.js';
import { WorkspaceProvider } from './providers/workspaceProvider.js';

export class ContextOverflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContextOverflowError';
  }
}

interface CustomDatabase extends Database {
  commitSummary(summary: string): void;
}

export class ContextBase {
  private projectPath: string;
  private envPath: string;
  private db: Database;
  private options: Record<string, unknown>;

  private directiveProvider: DirectiveProvider;
  private workspaceProvider: WorkspaceProvider;
  private taskProvider: TaskProvider;
  private globalRulesProvider: GlobalRulesProvider;
  private directoryTreeProvider: DirectoryTreeProvider;
  private hintProvider: HintProvider;
  private skillProvider: SkillProvider;
  private gardenProvider: GardenProvider;
  private anchorProvider: AnchorProvider;
  private lspProvider: LSPProvider;
  private knowledgeProvider: KnowledgeProvider;
  private toolProvider: ToolProvider;
  private stateProvider: StateProvider;
  private backgroundProcessProvider: BackgroundProcessProvider;

  // ... other providers

  constructor(
    projectPath: string,
    db: Database,
    options: Record<string, unknown> = {},
  ) {
    this.projectPath = path.resolve(projectPath);
    this.envPath =
      PathResolver.environmentPath(this.projectPath) || this.projectPath;
    this.db = db;
    this.options = options || {};

    const envOpts = { ...this.options, envPath: this.envPath };

    this.directiveProvider = new DirectiveProvider(
      this.projectPath,
      this.options,
    );
    this.workspaceProvider = new WorkspaceProvider(this.projectPath);
    this.taskProvider = new TaskProvider(this.projectPath);

    this.globalRulesProvider = new GlobalRulesProvider(
      this.projectPath,
      envOpts,
    );
    this.directoryTreeProvider = new DirectoryTreeProvider(
      this.projectPath,
      this.options,
    );
    this.hintProvider = new HintProvider(this.projectPath, envOpts);
    this.skillProvider = new SkillProvider(this.projectPath, envOpts);
    this.gardenProvider = new GardenProvider(this.projectPath, envOpts);
    this.anchorProvider = new AnchorProvider(this.projectPath, {
      ...envOpts,
      state: this.db,
    });

    this.lspProvider = new LSPProvider(
      this.projectPath,
      this.options.lsp_manager as LSPManager | undefined,
    );
    this.knowledgeProvider = new KnowledgeProvider(this.projectPath, envOpts);
    this.toolProvider = new ToolProvider(this.projectPath, {
      ...this.options,
      state: db,
    });

    this.stateProvider = new StateProvider(db, this.options);
    this.backgroundProcessProvider = new BackgroundProcessProvider(
      this.projectPath,
      envOpts,
    );
  }

  public assemble(): ContextPayload {
    const rawSections: Record<string, string> = {
      directive: this.directiveProvider.provide(),
      workspace: this.workspaceProvider.provide() || '',
      task: this.taskProvider.provide() || '',
      env: this.buildEnvironmentContent() || '',
      lsp: this.lspProvider.provide() || '',
      knowledge: this.knowledgeProvider.provide() || '',
      state: this.stateProvider.provide() || '',
      tools: this.toolProvider.provide() || '',
    };

    const totalLen = Object.values(rawSections).join('\n\n').length;
    const limit = this.fetchMaxChars();

    let sections = rawSections;
    if (limit && limit > 0 && totalLen > limit) {
      sections = this.compressSections(rawSections, limit);
    }

    const tools = this.toolProvider.provide_structured();

    const prompt = new ContextPrompt(
      sections.directive || '',
      sections.workspace || '',
      sections.task || '',
    );

    const envProvider = new ContextEnvProvider(
      sections.env || '',
      sections.lsp || '',
      sections.knowledge || '',
    );

    const memory = new ContextMemory(sections.state || '');

    return new ContextPayload(
      prompt,
      envProvider,
      memory,
      tools,
      this.options,
      sections,
    );
  }

  private fetchMaxChars(): number | null {
    try {
      const cfg = ConfigManager.loadTyped(this.envPath);
      const limit = cfg.state_management?.max_state_chars;
      return limit ? Number(limit) : null;
    } catch (_e) {
      return null;
    }
  }

  private compressSections(
    sections: Record<string, string>,
    limit: number,
  ): Record<string, string> {
    const order = [
      'directive',
      'workspace',
      'task',
      'tools',
      'knowledge',
      'env',
      'lsp',
      'state',
    ];

    let compressed = { ...sections };
    compressed = this.statePriorityCompress(compressed, limit);

    const calcTotal = (s: Record<string, string>) =>
      order
        .map((k) => s[k])
        .filter(Boolean)
        .join('\n\n').length;
    if (calcTotal(compressed) <= limit) {
      return compressed;
    }

    // Step 2: Drop optional sections in order of importance
    const dropOrder = ['lsp', 'env', 'tools'];
    for (const key of dropOrder) {
      if (compressed[key]) {
        compressed[key] = '';
        if (calcTotal(compressed) <= limit) {
          return compressed;
        }
      }
    }

    // Step 3: Aggressive state trimming
    if (calcTotal(compressed) > limit) {
      compressed = this.aggressiveStateTrim(compressed, limit);
    }

    const finalLen = calcTotal(compressed);
    if (finalLen > limit) {
      const errorMsg = `Compressed context length ${finalLen} exceeds max_state_chars ${limit}`;
      if (
        this.db &&
        typeof (this.db as CustomDatabase).commitSummary === 'function'
      ) {
        (this.db as CustomDatabase).commitSummary(
          `Context assembly failed: ${errorMsg}`,
        );
      }
      throw new ContextOverflowError(errorMsg);
    }

    return compressed;
  }

  private statePriorityCompress(
    sections: Record<string, string>,
    limit: number,
  ): Record<string, string> {
    if (!sections.state) return sections;

    const current = sections.state;
    const calcTotal = (s: Record<string, string>) =>
      Object.values(s).join('\n\n').length;

    if (calcTotal(sections) <= limit) return sections;

    const cfg = this.loadFullConfig();
    const cc = cfg.context_compression || {};
    const perEventCap = Number(cc.event_max_chars ?? 800);
    const minEventThreshold = Number(cc.event_min_count_threshold ?? 10);
    const summaryTrimStep = Number(cc.summary_trim_step ?? 5);

    const historyTag = '### History:';
    const avTag = current.includes('### Variables:')
      ? '### Variables:'
      : '### Active Variables:';

    const historyIdx = current.indexOf(historyTag);
    const avIdx = current.indexOf(avTag);

    let pre = '';
    let historyBlock = '';
    let avBlock = '';

    if (historyIdx !== -1 && avIdx !== -1) {
      if (historyIdx < avIdx) {
        pre = current.substring(0, historyIdx);
        historyBlock = current.substring(historyIdx, avIdx);
        avBlock = current.substring(avIdx);
      } else {
        pre = current.substring(0, avIdx);
        avBlock = current.substring(avIdx, historyIdx);
        historyBlock = current.substring(historyIdx);
      }
    } else if (historyIdx !== -1) {
      pre = current.substring(0, historyIdx);
      historyBlock = current.substring(historyIdx);
    } else if (avIdx !== -1) {
      pre = current.substring(0, avIdx);
      avBlock = current.substring(avIdx);
    } else {
      pre = current;
    }

    if (!historyBlock) return sections;

    const historyLines = historyBlock.split('\n');
    const header = historyLines.shift() || '';
    let events = [...historyLines];

    // Truncate individual events
    if (perEventCap > 0) {
      const dbRelPath = this.db.name
        ? path.relative(this.projectPath, this.db.name).replace(/\\/g, '/')
        : '.aura/state/sessions/default.db';
      events = events.map((line) => {
        if (line && line.length > perEventCap) {
          const notice = `...[truncated; full payload in ${dbRelPath} (events.payload); use sqlite3 to query]`;
          const maxBody = Math.max(0, perEventCap - notice.length);
          return line.substring(0, maxBody) + notice;
        }
        return line;
      });
    }

    sections.state = [pre, [header, ...events].join('\n'), avBlock]
      .filter(Boolean)
      .join('');

    if (calcTotal(sections) <= limit) return sections;

    // Drop older events until threshold
    while (calcTotal(sections) > limit && events.length > minEventThreshold) {
      events.shift();
      sections.state = [pre, [header, ...events].join('\n'), avBlock]
        .filter(Boolean)
        .join('');
    }

    // summary trim step
    if (calcTotal(sections) > limit && summaryTrimStep > 0) {
      while (calcTotal(sections) > limit && events.length > 0) {
        const drop = Math.min(summaryTrimStep, events.length);
        events.splice(0, drop);
        sections.state = [pre, [header, ...events].join('\n'), avBlock]
          .filter(Boolean)
          .join('');
      }
    }

    return sections;
  }

  private aggressiveStateTrim(
    sections: Record<string, string>,
    limit: number,
  ): Record<string, string> {
    if (!sections.state) return sections;
    const calcTotal = (s: Record<string, string>) =>
      Object.values(s).filter(Boolean).join('\n\n').length;
    if (calcTotal(sections) <= limit) return sections;

    const current = sections.state;
    const historyTag = '### History:';
    const avTag = current.includes('### Variables:')
      ? '### Variables:'
      : '### Active Variables:';

    const historyIdx = current.indexOf(historyTag);
    const avIdx = current.indexOf(avTag);

    if (historyIdx === -1) return sections;

    let pre = '';
    let historyBlock = '';
    let avBlock = '';

    if (historyIdx !== -1 && avIdx !== -1) {
      if (historyIdx < avIdx) {
        pre = current.substring(0, historyIdx);
        historyBlock = current.substring(historyIdx, avIdx);
        avBlock = current.substring(avIdx);
      } else {
        pre = current.substring(0, avIdx);
        avBlock = current.substring(avIdx, historyIdx);
        historyBlock = current.substring(historyIdx);
      }
    } else {
      pre = current.substring(0, historyIdx);
      historyBlock = current.substring(historyIdx);
    }

    const historyLines = historyBlock.split('\n');
    const header = historyLines.shift() || '';
    const events = [...historyLines];

    while (calcTotal(sections) > limit && events.length > 1) {
      events.shift();
      sections.state = [pre, [header, ...events].join('\n'), avBlock]
        .filter(Boolean)
        .join('');
    }

    return sections;
  }

  private loadFullConfig(): AuraConfig {
    try {
      return ConfigManager.loadTyped(this.envPath);
    } catch (_e) {
      return parseAuraConfig({});
    }
  }

  public buildEnvironmentContent(): string | null {
    const sections = ['# SYSTEM & ENVIRONMENT'];

    const globalRules = this.globalRulesProvider.provide();
    if (globalRules)
      sections.push(`## Global Rules
${globalRules}`);

    const workspaceTree = this.directoryTreeProvider.provide();
    if (workspaceTree)
      sections.push(`## Workspace Overview
${workspaceTree}`);

    const magicHints = this.hintProvider.provide();
    if (magicHints?.trim())
      sections.push(`## Active Tags & Guidance
${magicHints}`);

    const skillsKnowledge = this.skillProvider.provide();
    if (skillsKnowledge)
      sections.push(`## Skills Knowledge
${skillsKnowledge}`);

    const gardenKnowledge = this.gardenProvider.provide();
    if (gardenKnowledge)
      sections.push(`## Garden Playbooks
${gardenKnowledge}`);

    const userTask = this.anchorProvider.provide();
    if (userTask)
      sections.push(`## User Tasks
${userTask}`);

    const backgroundProcesses = this.backgroundProcessProvider.provide();
    if (backgroundProcesses) {
      sections.push(backgroundProcesses);
    }

    if (sections.length <= 1) {
      return null;
    }

    return sections.join('\n\n');
  }
}
