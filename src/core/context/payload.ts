import type { ChatMessage, ToolSchema } from '../llm/types.js';
import type { StructuredTool } from './providers/toolProvider.js';

export class ContextPrompt {
  constructor(
    public readonly kernel_prompt: string,
    public readonly workspace_prompt: string,
    public readonly task_prompt: string,
  ) {}
}

export class ContextEnvProvider {
  constructor(
    public readonly overview: string,
    public readonly lsp: string,
    public readonly knowledge: string,
  ) {}
}

export class ContextMemory {
  constructor(public readonly state: string) {}
}

export class ContextPayload {
  public readonly prompt?: ContextPrompt | null;
  public readonly env_provider?: ContextEnvProvider | null;
  public readonly memory?: ContextMemory | null;
  public readonly tools: StructuredTool[];
  public readonly options: Record<string, unknown>;
  public readonly sections: Record<string, string>;

  constructor(
    promptOrSections: ContextPrompt | Record<string, string>,
    envProviderOrTools: ContextEnvProvider | StructuredTool[] = [],
    memoryOrOptions: ContextMemory | Record<string, unknown> = {},
    tools: StructuredTool[] = [],
    options: Record<string, unknown> = {},
    sections: Record<string, string> = {},
  ) {
    const isSignature1 =
      Array.isArray(envProviderOrTools) ||
      (promptOrSections !== null &&
        promptOrSections !== undefined &&
        !(promptOrSections instanceof ContextPrompt) &&
        !Array.isArray(promptOrSections) &&
        !(memoryOrOptions instanceof ContextMemory));

    if (isSignature1) {
      // Signature: (sections, tools, options)
      this.sections = (promptOrSections as Record<string, string>) || {};
      this.tools = (envProviderOrTools as StructuredTool[]) || [];
      this.options = (memoryOrOptions as Record<string, unknown>) || {};
      this.memory = null;

      this.prompt = new ContextPrompt(
        this.sections.directive || '',
        this.sections.workspace || '',
        this.sections.task || '',
      );
      this.env_provider = new ContextEnvProvider(
        this.sections.env || '',
        this.sections.lsp || '',
        this.sections.knowledge || '',
      );
      this.memory = new ContextMemory(this.sections.state || '');
    } else {
      // Signature: (prompt, env_provider, memory, tools, options, sections)
      this.prompt = promptOrSections as ContextPrompt | null;
      this.env_provider = envProviderOrTools as ContextEnvProvider | null;
      this.memory = memoryOrOptions as ContextMemory | null;
      this.tools = tools || [];
      this.options = options || {};
      this.sections = { ...(sections || {}) };

      if (this.prompt) {
        this.sections.directive =
          this.sections.directive || this.prompt.kernel_prompt;
        this.sections.workspace =
          this.sections.workspace || this.prompt.workspace_prompt;
        this.sections.task = this.sections.task || this.prompt.task_prompt;
      }
      if (this.env_provider) {
        this.sections.env = this.sections.env || this.env_provider.overview;
        this.sections.lsp = this.sections.lsp || this.env_provider.lsp;
        this.sections.knowledge =
          this.sections.knowledge || this.env_provider.knowledge;
      }
      if (this.memory) {
        this.sections.state = this.sections.state || this.memory.state;
      }
    }
  }

  public toMarkdownExcluding(excludedKeys: string[] = []): string {
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

    return order
      .map((k) => {
        if (excludedKeys.includes(k)) return null;
        return this.sections[k];
      })
      .filter(Boolean)
      .join('\n\n');
  }

  public toMarkdown(): string {
    return this.toMarkdownExcluding([]);
  }

  public toString(): string {
    return this.toMarkdown();
  }

  public toMessages(options: { goal?: string | null } = {}): ChatMessage[] {
    const mode = this.options.directive_mode;
    const goal = options.goal;

    if (mode === 'ralph_developer' || mode === 'ralph_critic') {
      const systemPrompt = [
        this.prompt?.kernel_prompt || this.sections.directive || '',
        this.prompt?.workspace_prompt || this.sections.workspace || '',
        this.prompt?.task_prompt || this.sections.task || '',
      ]
        .filter(Boolean)
        .join('\n\n');
      const userContent = this.buildUserContent(goal);
      return [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ];
    } else {
      const userContent = this.buildUserContent(goal);
      if (!userContent) return [];
      return [{ role: 'user', content: userContent }];
    }
  }

  public toToolSchemas(): ToolSchema[] {
    if (!this.tools || this.tools.length === 0) return [];

    return this.tools.map((tool) => {
      let schema = tool.input_schema || {};
      schema = this.processSchema(schema);
      schema = this.normalizeSchema(schema);

      return {
        name: tool.name,
        description: tool.description || '',
        input_schema: schema,
      };
    });
  }

  private buildUserContent(goal?: string | null): string {
    const mode = this.options.directive_mode;

    if (mode === 'ralph_critic') {
      const audit = (this.options.ralph_audit as Record<string, string>) || {};
      const changes = audit.changes || '';
      const previousAudit = audit.previous_audit || '';
      const testOutput = audit.test_output || '';
      const taskContent = audit.task_content || '';

      const criticMode = String(
        this.options.critic_mode || 'light',
      ).toLowerCase();
      // Heavy critic includes all context parts except directive, workspace, task, state
      const parts =
        criticMode === 'heavy'
          ? this.toMarkdownExcluding([
              'directive',
              'workspace',
              'task',
              'state',
            ])
          : null;

      return [
        parts,
        `# INITIAL GOAL\n${goal || ''}`,
        `# PREVIOUS CRITIC AUDIT\n${previousAudit}`,
        `# CURRENT WORKSPACE CHANGES\n${changes}`,
        `# PHYSICAL TEST EXECUTION VERIFICATION LOG\n${testOutput}`,
        `# TASK CHECKLIST\n${taskContent}`,
        'Please audit these changes. Are they complete and correct according to the Goal?\n' +
          'Does it address the previous critique and satisfy all acceptance criteria?',
      ]
        .filter(Boolean)
        .join('\n\n');
    } else if (mode === 'ralph_developer') {
      const parts = this.toMarkdownExcluding([
        'directive',
        'workspace',
        'task',
        'tools',
      ]);

      const recap = (this.options.ralph_recap as Record<string, string>) || {};
      const lastTool = recap.last_tool || 'None';
      const lastOutput = recap.last_output || 'No tools executed yet.';
      const lastTest = recap.last_test || 'Not run yet.';
      const verifierMode = recap.verifier_mode || 'Physical Command';

      const recapText = [
        '# LAST ITERATION RECAP',
        `- **Last Tool Executed**: \`${lastTool}\``,
        '- **Last Tool Result**:',
        '```',
        lastOutput,
        '```',
        '',
        '# CURRENT VERIFICATION STATUS',
        `- **Verifier Mode**: ${verifierMode}`,
        '- **Verification Feedback**:',
        '```',
        lastTest,
        '```',
      ].join('\n');

      return [
        parts,
        recapText,
        '## CURRENT USER TASK',
        String(goal || '').trim(),
      ]
        .filter(Boolean)
        .join('\n\n');
    } else {
      // Exclude tool descriptions because tools schema are passed separately in native API
      let parts = this.toMarkdownExcluding(['tools']);
      if (goal && String(goal).trim()) {
        parts = [parts, '## CURRENT USER TASK', String(goal).trim()]
          .filter(Boolean)
          .join('\n\n');
      }
      return parts;
    }
  }

  private normalizeSchema(
    schema: Record<string, unknown>,
  ): Record<string, unknown> {
    if (!schema || typeof schema !== 'object') {
      return { type: 'object', properties: {}, required: [] };
    }
    if (schema.type) {
      return this.processSchema(schema);
    }
    const wrapped = {
      type: 'object',
      properties: schema.properties || {},
      required: schema.required || [],
    };
    return this.processSchema(wrapped as Record<string, unknown>);
  }

  private processSchema(
    schema: Record<string, unknown>,
  ): Record<string, unknown> {
    if (!schema || typeof schema !== 'object') return schema;

    const props = schema.properties;
    if (props && typeof props === 'object') {
      for (const [_k, v] of Object.entries(props)) {
        if (v && typeof v === 'object') {
          const val = v as Record<string, unknown>;
          if (String(val.type) === 'array' && !val.items) {
            val.items = { type: 'string' };
          }
        }
      }
    }
    return schema;
  }
}
