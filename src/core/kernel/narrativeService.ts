import { LLMClient } from '../llm/client.js';
import { ConfigManager } from '../../utils/configManager.js';

export class NarrativeService {
  private projectPath: string;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
  }

  public async synthesize(events: any[]): Promise<string> {
    if (events.length === 0) {
      return 'No events to summarize.';
    }

    let client: LLMClient;
    try {
      const cfg = ConfigManager.load(this.projectPath) || {};
      const llmCfg = cfg.llm || {};
      client = LLMClient.fromConfig(llmCfg, this.projectPath);
    } catch (e: any) {
      return `Metabolism synthesis failed to load config: ${e.message}`;
    }

    const prompt = this.composePrompt(events);
    const systemPrompt = 'System Instructions: You are an expert technical summarizer. Your goal is to condense a series of tool execution events into a concise progress narrative for an AI agent.';
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ];

    try {
      const out = await client.complete(messages, { temperature: 0.3, max_tokens: 500 });
      return out.content.trim();
    } catch (e: any) {
      return `Metabolism synthesis failed: ${e.message}. Cleared old events.`;
    }
  }

  private composePrompt(events: any[]): string {
    const eventStr = events.map(e => {
      const payload = e.payload || {};
      const tool = e.tool || '';
      const phase = e.phase || '';
      return `- [${phase}] ${tool}: ${JSON.stringify(payload)}`;
    }).join('\n');

    return [
      'Please synthesize the following tool execution history into a concise "Progress Narrative".',
      'Focus on what was attempted, what the result was, and the current status.',
      'Keep it under 200 words.',
      '',
      '### History:',
      eventStr,
      '',
      '### Focus on:',
      '- Key files modified',
      '- Critical test results',
      '- Any blockers encountered',
      '- The cumulative result of these steps',
    ].join('\n');
  }
}
