import { describe, it, expect, beforeAll, vi } from 'vitest';
import { Client } from '../../src/core/llm/client.js';
import { BaseAdapter, CompletionResult } from '../../src/core/llm/adapters/base.js';
import { LLMError, LLMAuthError, LLMBadRequestError, LLMTimeoutError } from '../../src/core/llm/errors.js';

class MockSuccessAdapter extends BaseAdapter {
  public async complete(_messages: any[], _options?: any): Promise<CompletionResult> {
    return { content: `Success (key: ${this.apiKey}, model: ${this.model})`, raw: null, finish_reason: 'stop' };
  }

  public async completeStream(
    _messages: any[],
    _options?: any,
    onChunk?: (delta: string) => void
  ): Promise<CompletionResult> {
    onChunk?.(`Stream Success (key: ${this.apiKey}, model: ${this.model})`);
    return { content: 'Full Content', raw: null, finish_reason: 'stop' };
  }
}

class MockFailAdapter extends BaseAdapter {
  public calls = 0;

  public async complete(_messages: any[], _options?: any): Promise<CompletionResult> {
    this.calls++;
    if (this.model === 'auth_fail') {
      throw new LLMAuthError('Auth fail');
    } else if (this.model === 'bad_request_fail') {
      throw new LLMBadRequestError('Bad Request parameters');
    } else if (this.model === 'rate_limit_fail') {
      throw new LLMError('LLM API Error (429): Rate limited');
    } else {
      throw new LLMError(`API Error on ${this.model}`);
    }
  }

  public async completeStream(
    _messages: any[],
    _options?: any,
    _onChunk?: (delta: string) => void
  ): Promise<CompletionResult> {
    this.calls++;
    throw new LLMError(`API Error on ${this.model}`);
  }
}

class MockTransientAdapter extends BaseAdapter {
  public failCount = 2;
  public callCount = 0;

  public async complete(_messages: any[], _options?: any): Promise<CompletionResult> {
    this.callCount++;
    if (this.callCount <= this.failCount) {
      throw new LLMError(`Transient API Error (attempt ${this.callCount})`);
    } else {
      return { content: `Recovered (key: ${this.apiKey}, model: ${this.model})`, raw: null, finish_reason: 'stop' };
    }
  }
}

class MockStreamAdapter extends BaseAdapter {
  public yieldThenFail = false;

  constructor(config: any) {
    super(config);
    this.yieldThenFail = config.model === 'yield_then_fail';
  }

  public async completeStream(
    _messages: any[],
    _options?: any,
    onChunk?: (delta: string) => void
  ): Promise<CompletionResult> {
    if (this.yieldThenFail) {
      onChunk?.('Part 1');
      throw new LLMError('Mid-stream error');
    } else {
      onChunk?.(`Stream Success (key: ${this.apiKey}, model: ${this.model})`);
      return { content: 'Full Content', raw: null, finish_reason: 'stop' };
    }
  }
}

beforeAll(() => {
  Client.registerAdapter('mock_success', MockSuccessAdapter);
  Client.registerAdapter('mock_fail', MockFailAdapter);
  Client.registerAdapter('mock_transient', MockTransientAdapter);
  Client.registerAdapter('mock_stream', MockStreamAdapter);
});

describe('LLM Client Failover & Retries', () => {
  it('test_from_config_parses_backup_and_fallbacks', () => {
    const config = {
      provider: 'mock_success',
      model: 'primary-model',
      api_key: 'primary-key',
      max_retries: 3,
      fallbacks: [
        { provider: 'mock_success', model: 'fallback-model-1', api_key: 'key-1', max_retries: 0 },
        { provider: 'mock_success', model: 'fallback-model-2', api_key: 'key-2' },
      ],
    };

    const client = Client.fromConfig(config);
    const chain = client.configsChain();

    expect(chain.length).toBe(3);
    expect(chain[0].model).toBe('primary-model');
    expect(chain[1].model).toBe('fallback-model-1');
    expect(chain[1].maxRetries).toBe(0);
    expect(chain[2].model).toBe('fallback-model-2');
  });

  it('test_from_config_supports_singular_backup', () => {
    const config = {
      provider: 'mock_success',
      model: 'primary-model',
      api_key: 'primary-key',
      backup: { provider: 'mock_success', model: 'backup-model', api_key: 'backup-key' },
    };

    const client = Client.fromConfig(config);
    const chain = client.configsChain();

    expect(chain.length).toBe(2);
    expect(chain[0].model).toBe('primary-model');
    expect(chain[1].model).toBe('backup-model');
  });

  it('test_transient_retry_success', async () => {
    const config = {
      provider: 'mock_transient',
      model: 'transient-model',
      api_key: 'some-key',
      max_retries: 2,
    };

    const client = Client.fromConfig(config);

    const sleeps: number[] = [];
    vi.spyOn(client as any, 'sleep').mockImplementation((sec: number) => {
      sleeps.push(sec);
      return Promise.resolve();
    });

    const res = await client.complete([{ role: 'user', content: 'hello' }]);
    expect(res.content).toBe('Recovered (key: some-key, model: transient-model)');
    expect(sleeps).toEqual([1, 2]);
  });

  it('test_failover_when_primary_fails', async () => {
    const config = {
      provider: 'mock_fail',
      model: 'bad-primary',
      api_key: 'primary-key',
      max_retries: 1,
      fallbacks: [
        { provider: 'mock_success', model: 'good-backup', api_key: 'backup-key' },
      ],
    };

    const client = Client.fromConfig(config);
    vi.spyOn(client as any, 'sleep').mockResolvedValue(undefined);

    const res = await client.complete([{ role: 'user', content: 'hello' }]);
    expect(res.content).toBe('Success (key: backup-key, model: good-backup)');
  });

  it('test_stream_failover_before_yielding', async () => {
    const config = {
      provider: 'mock_fail',
      model: 'bad-primary',
      api_key: 'primary-key',
      max_retries: 1,
      fallbacks: [
        { provider: 'mock_stream', model: 'good-backup', api_key: 'backup-key' },
      ],
    };

    const client = Client.fromConfig(config);
    vi.spyOn(client as any, 'sleep').mockResolvedValue(undefined);

    const yieldedChunks: string[] = [];
    await client.completeStream([{ role: 'user', content: 'hello' }], {}, (delta) => {
      yieldedChunks.push(delta);
    });

    expect(yieldedChunks).toEqual(['Stream Success (key: backup-key, model: good-backup)']);
  });

  it('test_stream_error_raised_immediately_if_already_yielded', async () => {
    const config = {
      provider: 'mock_stream',
      model: 'yield_then_fail',
      api_key: 'some-key',
      max_retries: 1,
      fallbacks: [
        { provider: 'mock_stream', model: 'should-not-be-reached', api_key: 'backup-key' },
      ],
    };

    const client = Client.fromConfig(config);
    vi.spyOn(client as any, 'sleep').mockResolvedValue(undefined);

    const yieldedChunks: string[] = [];
    
    await expect(
      client.completeStream([{ role: 'user', content: 'hello' }], {}, (delta) => {
        yieldedChunks.push(delta);
      })
    ).rejects.toThrow('Mid-stream error');

    expect(yieldedChunks).toEqual(['Part 1']);
  });

  it('test_non_retryable_errors', async () => {
    const config = {
      provider: 'mock_fail',
      model: 'auth_fail',
      api_key: 'some-key',
      max_retries: 3,
      fallbacks: [
        { provider: 'mock_success', model: 'good-backup', api_key: 'backup-key' },
      ],
    };

    const client = Client.fromConfig(config);
    
    const sleeps: number[] = [];
    vi.spyOn(client as any, 'sleep').mockImplementation((sec: number) => {
      sleeps.push(sec);
      return Promise.resolve();
    });

    const res = await client.complete([{ role: 'user', content: 'hello' }]);
    
    expect(res.content).toBe('Success (key: backup-key, model: good-backup)');
    expect(sleeps).toEqual([]);
  });

  it('test_non_retryable_bad_request_error', async () => {
    const config = {
      provider: 'mock_fail',
      model: 'bad_request_fail',
      api_key: 'some-key',
      max_retries: 3,
      fallbacks: [
        { provider: 'mock_success', model: 'good-backup', api_key: 'backup-key' },
      ],
    };

    const client = Client.fromConfig(config);
    const sleeps: number[] = [];
    vi.spyOn(client as any, 'sleep').mockImplementation((sec: number) => {
      sleeps.push(sec);
      return Promise.resolve();
    });

    const res = await client.complete([{ role: 'user', content: 'hello' }]);
    
    expect(res.content).toBe('Success (key: backup-key, model: good-backup)');
    expect(sleeps).toEqual([]);
  });

  it('test_retryable_rate_limit_error', async () => {
    const config = {
      provider: 'mock_fail',
      model: 'rate_limit_fail',
      api_key: 'some-key',
      max_retries: 1,
      fallbacks: [
        { provider: 'mock_success', model: 'good-backup', api_key: 'backup-key' },
      ],
    };

    const client = Client.fromConfig(config);
    const sleeps: number[] = [];
    vi.spyOn(client as any, 'sleep').mockImplementation((sec: number) => {
      sleeps.push(sec);
      return Promise.resolve();
    });

    const res = await client.complete([{ role: 'user', content: 'hello' }]);
    
    expect(res.content).toBe('Success (key: backup-key, model: good-backup)');
    expect(sleeps).toEqual([1]);
  });

  it('test_circuit_breaker_tripping_and_cooldown', async () => {
    const config = {
      provider: 'mock_fail',
      model: 'always_fail',
      api_key: 'some-key',
      max_retries: 0,
      fallbacks: [
        { provider: 'mock_success', model: 'good-backup', api_key: 'backup-key' },
      ],
    };

    const client = Client.fromConfig(config);
    vi.spyOn(client as any, 'sleep').mockResolvedValue(undefined);

    // Fail the primary 3 times
    await client.complete([{ role: 'user', content: 'hello' }]);
    await client.complete([{ role: 'user', content: 'hello' }]);
    await client.complete([{ role: 'user', content: 'hello' }]);

    expect((client as any).currentConfig.model).toBe('good-backup');

    // Reset current config back to primary to test cooldown filtering
    (client as any).currentConfig = (client as any).configsChain()[0];

    const builtConfigs: any[] = [];
    vi.spyOn(client as any, 'buildAdapter').mockImplementation((cfg: any) => {
      builtConfigs.push(cfg);
      return (client as any).buildAdapter.mock.calls.length > 0
        ? new MockSuccessAdapter(cfg)
        : new MockFailAdapter(cfg);
    });

    await client.complete([{ role: 'user', content: 'hello' }]);

    expect(builtConfigs.map(c => c.model)).not.toContain('always_fail');
  });

  it('test_per_fallback_max_retries', async () => {
    const config = {
      provider: 'mock_fail',
      model: 'primary',
      api_key: 'some-key',
      max_retries: 0,
      fallbacks: [
        { provider: 'mock_fail', model: 'fallback-1', api_key: 'some-key', max_retries: 2 },
        { provider: 'mock_success', model: 'good-backup', api_key: 'backup-key' },
      ],
    };

    const client = Client.fromConfig(config);
    
    const sleeps: number[] = [];
    vi.spyOn(client as any, 'sleep').mockImplementation((sec: number) => {
      sleeps.push(sec);
      return Promise.resolve();
    });

    const res = await client.complete([{ role: 'user', content: 'hello' }]);
    
    expect(res.content).toBe('Success (key: backup-key, model: good-backup)');
    expect(sleeps).toEqual([1, 2]);
  });
});
