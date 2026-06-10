import readline from 'node:readline';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type SpyInstance,
  vi,
} from 'vitest';
import { ConsoleRenderer } from '../../src/cli/shell/consoleRenderer.js';
import * as UI from '../../src/cli/ui.js';

function stripAnsi(str: string): string {
  return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

interface MockSpinner {
  start: SpyInstance;
  message: SpyInstance;
  stop: SpyInstance;
}

interface MockReadline {
  question: SpyInstance;
  close: SpyInstance;
}

describe('ConsoleRenderer', () => {
  let stdoutWriteSpy: SpyInstance;
  let _stderrWriteSpy: SpyInstance;
  let consoleLogSpy: SpyInstance;
  let consoleWarnSpy: SpyInstance;
  let consoleErrorSpy: SpyInstance;

  beforeEach(() => {
    stdoutWriteSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    _stderrWriteSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('test_on_token', () => {
    const renderer = new ConsoleRenderer();
    renderer.onToken('hello');
    expect(stdoutWriteSpy).toHaveBeenCalledWith('\r\x1b[K');
    expect(stdoutWriteSpy).toHaveBeenCalledWith('hello');
  });

  it('test_on_stream_end', () => {
    const renderer = new ConsoleRenderer();
    renderer.onToken('hello');
    renderer.onStreamEnd();
    expect(stdoutWriteSpy).toHaveBeenCalledWith('\n');
  });

  it('test_on_waiting', () => {
    const mockSpinner: MockSpinner = {
      start: vi.fn(),
      message: vi.fn(),
      stop: vi.fn(),
    };

    const showSpinnerSpy = vi
      .spyOn(UI, 'showSpinner')
      .mockReturnValue(mockSpinner as any);

    const renderer = new ConsoleRenderer();
    renderer.onWaiting(1.5);

    expect(showSpinnerSpy).toHaveBeenCalledWith('Waiting for response...');
    expect(mockSpinner.message).toHaveBeenCalledWith(
      'Waiting for response... (1.5s)',
    );
  });

  it('test_on_clear_waiting', () => {
    const mockSpinner: MockSpinner = {
      start: vi.fn(),
      message: vi.fn(),
      stop: vi.fn(),
    };
    const _showSpinnerSpy = vi
      .spyOn(UI, 'showSpinner')
      .mockReturnValue(mockSpinner as any);

    const renderer = new ConsoleRenderer();
    renderer.onWaiting(1.5);
    renderer.onClearWaiting();

    expect(mockSpinner.stop).toHaveBeenCalledWith('');
    expect(stdoutWriteSpy).toHaveBeenCalledWith('\r\x1b[K');
  });

  it('test_on_tool_start_verbose', () => {
    const renderer = new ConsoleRenderer({ verbose: true });
    renderer.onToolStart('write_file', 'write text to file', { path: 'a.txt' });

    const logs = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    const cleanLogs = stripAnsi(logs);
    expect(cleanLogs).toContain('Tool: write_file');
    expect(cleanLogs).toContain('Summary: write text to file');
    expect(cleanLogs).toContain('Args: {"path":"a.txt"}');
  });

  it('test_on_tool_executing', () => {
    const renderer = new ConsoleRenderer();
    renderer.onToolExecuting();
    expect(consoleLogSpy).toHaveBeenCalledWith('   🚀 Executing...');
  });

  it('test_on_tool_result', () => {
    const renderer = new ConsoleRenderer();
    const result = {
      status: 'ok',
      output: 'file written successfully',
      modified_files: ['a.txt'],
    };
    renderer.onToolResult(result);

    const logs = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    const cleanLogs = stripAnsi(logs);
    expect(cleanLogs).toContain('Status: ok');
    expect(cleanLogs).toContain('file written successfully');
    expect(cleanLogs).toContain('Modified files:');
    expect(cleanLogs).toContain('a.txt');
  });

  it('test_on_thought', () => {
    const renderer = new ConsoleRenderer();
    renderer.onThought('thinking aloud', 2.3);

    const logs = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    const cleanLogs = stripAnsi(logs);
    expect(cleanLogs).toContain('Response (2.3s):');
    expect(cleanLogs).toContain('thinking aloud');
  });

  it('test_on_error', () => {
    const renderer = new ConsoleRenderer();
    renderer.onError('system crash');

    const errs = consoleErrorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    const cleanErrs = stripAnsi(errs);
    expect(cleanErrs).toContain('Error: system crash');
  });

  it('test_on_warning', () => {
    const renderer = new ConsoleRenderer();
    renderer.onWarning('deprecated');

    const warns = consoleWarnSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    const cleanWarns = stripAnsi(warns);
    expect(cleanWarns).toContain('deprecated');
  });

  it('test_ask_confirmation_yes', async () => {
    const renderer = new ConsoleRenderer();

    const mockRl: MockReadline = {
      question: vi.fn((_query: string, cb: (ans: string) => void) => {
        cb('y');
      }),
      close: vi.fn(),
    };
    vi.spyOn(readline, 'createInterface').mockReturnValue(
      mockRl as unknown as readline.Interface,
    );

    const result = await renderer.askConfirmation('Proceed?');
    expect(result).toBe(true);
    expect(mockRl.question).toHaveBeenCalled();
    expect(mockRl.close).toHaveBeenCalled();
  });

  it('test_ask_confirmation_no', async () => {
    const renderer = new ConsoleRenderer();

    const mockRl: MockReadline = {
      question: vi.fn((_query: string, cb: (ans: string) => void) => {
        cb('n');
      }),
      close: vi.fn(),
    };
    vi.spyOn(readline, 'createInterface').mockReturnValue(
      mockRl as unknown as readline.Interface,
    );

    const result = await renderer.askConfirmation('Proceed?');
    expect(result).toBe(false);
  });
});
