import { describe, expect, it, vi } from 'vitest';
import { LSPClient } from '../../src/core/ext/lsp/client.js';
import { StdioClient } from '../../src/core/ext/mcp/client.js';
import { ExecutionEngine } from '../../src/core/kernel/executionEngine.js';
import { Runner } from '../../src/core/kernel/runner.js';

describe('Lifecycle Cleanup Tests', () => {
  it('LSPClient.stop() kills after timeout', () => {
    vi.useFakeTimers();
    const client = new LSPClient('node', ['--version']);

    const mockProcess = {
      stdin: { end: vi.fn() },
      kill: vi.fn(),
    };
    (client as any).process = mockProcess;

    client.stop();
    expect((client as any).forceKillTimer).toBeDefined();

    // Fast-forward 1s
    vi.advanceTimersByTime(1000);

    expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL');
    expect((client as any).forceKillTimer).toBeUndefined();

    vi.useRealTimers();
  });

  it('LSPClient clears force kill timer if process exits early', () => {
    vi.useFakeTimers();
    const client = new LSPClient('node', ['--version']);

    const listeners: Record<string, (...args: any[]) => void> = {};
    const mockProcess = {
      stdin: { end: vi.fn() },
      kill: vi.fn(),
      on: vi.fn((event, callback) => {
        listeners[event] = callback;
      }),
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
    };

    // We stub spawn in LSPClient.start() by mocking child_process.spawn inside test environment
    // or we can simply manually invoke the start binding logic or mock spawn.
    // Instead of spawn, we can directly set this.process, and manually bind close
    (client as any).process = mockProcess;

    // Bind listeners manually as start() does
    mockProcess.on('close', (code: number) => {
      if ((client as any).forceKillTimer) {
        clearTimeout((client as any).forceKillTimer);
        (client as any).forceKillTimer = undefined;
      }
      (client as any).cleanup(new Error(`LSP server closed with code ${code}`));
    });

    client.stop();
    expect((client as any).forceKillTimer).toBeDefined();

    // Trigger close
    if (listeners.close) {
      listeners.close(0);
    }

    expect((client as any).forceKillTimer).toBeUndefined();
    vi.useRealTimers();
  });

  it('StdioClient.close() kills after timeout', () => {
    vi.useFakeTimers();
    const client = new StdioClient('node', ['--version']);

    const mockProcess = {
      stdin: { end: vi.fn() },
      kill: vi.fn(),
    };
    (client as any).process = mockProcess;

    client.close();
    expect((client as any).forceKillTimer).toBeDefined();

    // Fast-forward 1s
    vi.advanceTimersByTime(1000);

    expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL');
    expect((client as any).forceKillTimer).toBeUndefined();

    vi.useRealTimers();
  });

  it('StdioClient clears force kill timer if process exits early', () => {
    vi.useFakeTimers();
    const client = new StdioClient('node', ['--version']);

    const listeners: Record<string, (...args: any[]) => void> = {};
    const mockProcess = {
      stdin: { end: vi.fn() },
      kill: vi.fn(),
      on: vi.fn((event, callback) => {
        listeners[event] = callback;
      }),
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
    };

    (client as any).process = mockProcess;

    mockProcess.on('close', (code: number) => {
      if ((client as any).forceKillTimer) {
        clearTimeout((client as any).forceKillTimer);
        (client as any).forceKillTimer = undefined;
      }
      (client as any).cleanup(new Error(`MCP server closed with code ${code}`));
    });

    client.close();
    expect((client as any).forceKillTimer).toBeDefined();

    // Trigger close
    if (listeners.close) {
      listeners.close(0);
    }

    expect((client as any).forceKillTimer).toBeUndefined();
    vi.useRealTimers();
  });

  it('ExecutionEngine.destroy() kills background processes and clears map', async () => {
    const engine = new ExecutionEngine(process.cwd());
    const mockProcessStdin = {
      end: vi.fn(),
    };
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    (engine as any).ptyProcesses.set(12345, mockProcessStdin);
    (engine as any).ptyStates.set(12345, { resetPromptPending: vi.fn() });

    expect((engine as any).ptyProcesses.size).toBe(1);

    engine.destroy();

    expect(mockProcessStdin.end).toHaveBeenCalled();
    expect(killSpy).toHaveBeenCalledWith(12345, 'SIGKILL');
    expect((engine as any).ptyProcesses.size).toBe(0);
    expect((engine as any).ptyStates.size).toBe(0);

    killSpy.mockRestore();
  });

  it('Runner.destroy() stops LSP manager, engine, and database', async () => {
    const runner = new Runner(process.cwd());

    const mockLspManager = {
      stopAll: vi.fn(),
    };
    const mockEngine = {
      destroy: vi.fn(),
    };
    const mockStore = {
      close: vi.fn(),
    };

    (runner as any).lspManager = mockLspManager;
    (runner as any).engine = mockEngine;
    (runner as any).memory = { store: mockStore };

    runner.destroy();

    expect(mockLspManager.stopAll).toHaveBeenCalled();
    expect(mockEngine.destroy).toHaveBeenCalled();
    expect(mockStore.close).toHaveBeenCalled();
  });
});
