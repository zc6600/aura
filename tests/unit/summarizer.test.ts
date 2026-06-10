import { describe, expect, it, vi } from 'vitest';
import type { EventRecord as Event } from '../../src/core/memory/sqliteStore.js';
import { MemorySummarizer } from '../../src/core/memory/summarizer.js';

describe('MemorySummarizer', () => {
  it('should construct with default project path', () => {
    const summarizer = new MemorySummarizer();
    expect(summarizer.projectPath).toBe('.');
  });

  it('should return default message for empty events', async () => {
    const summarizer = new MemorySummarizer();
    const result = await summarizer.synthesize([]);
    expect(result).toBe('No events to summarize.');
  });

  it('should return fallback summary if no narrative service is configured', async () => {
    const summarizer = new MemorySummarizer();
    const dummyEvent: Event = {
      id: 1,
      timestamp: Date.now(),
      phase: 'execution',
      tool: 'read_file',
      payload: {},
    };
    const result = await summarizer.synthesize([dummyEvent, dummyEvent]);
    expect(result).toBe('Summary of 2 events');
  });

  it('should delegate to narrative service if configured', async () => {
    const summarizer = new MemorySummarizer();
    const mockNarrative = {
      synthesize: vi.fn().mockResolvedValue('Mocked Narrative Summary'),
    };
    summarizer.setNarrativeService(mockNarrative);

    const dummyEvent: Event = {
      id: 1,
      timestamp: Date.now(),
      phase: 'execution',
      tool: 'read_file',
      payload: {},
    };
    const result = await summarizer.synthesize([dummyEvent]);
    expect(result).toBe('Mocked Narrative Summary');
    expect(mockNarrative.synthesize).toHaveBeenCalledWith([dummyEvent]);
  });

  it('should handle narrative service exceptions gracefully', async () => {
    const summarizer = new MemorySummarizer();
    const mockNarrative = {
      synthesize: vi.fn().mockRejectedValue(new Error('LLM synthesis failed')),
    };
    summarizer.setNarrativeService(mockNarrative);

    const dummyEvent: Event = {
      id: 1,
      timestamp: Date.now(),
      phase: 'execution',
      tool: 'read_file',
      payload: {},
    };
    const result = await summarizer.synthesize([dummyEvent]);
    expect(result).toContain(
      'Metabolism synthesis failed: LLM synthesis failed',
    );
  });
});
