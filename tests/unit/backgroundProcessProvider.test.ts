import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { BackgroundProcessProvider } from '../../src/core/context/providers/backgroundProcessProvider.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('BackgroundProcessProvider', () => {
  const tempDir = path.resolve(__dirname, 'temp-bg-provider-test');
  const envPath = path.join(tempDir, '.aura');
  const commandsDir = path.join(envPath, 'state', 'commands');

  beforeAll(() => {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    if (fs.existsSync(commandsDir)) {
      fs.rmSync(commandsDir, { recursive: true, force: true });
    }
    fs.mkdirSync(commandsDir, { recursive: true });
    vi.restoreAllMocks();
  });

  it('should return null when commands directory does not exist', () => {
    const provider = new BackgroundProcessProvider(tempDir, {
      envPath: path.join(tempDir, 'nonexistent-env'),
    });
    expect(provider.provide()).toBeNull();
  });

  it('should return null when there are no active background processes', () => {
    const provider = new BackgroundProcessProvider(tempDir, { envPath });
    expect(provider.provide()).toBeNull();
  });

  it('should list active processes and read their logs', () => {
    // Write mock logs
    fs.writeFileSync(
      path.join(commandsDir, '12345.out'),
      'server started\nlistening on port 3000\n',
    );
    fs.writeFileSync(path.join(commandsDir, '12345.err'), 'some warning\n');

    // Write metadata
    const meta = {
      pid: 12345,
      command: 'npm run dev',
      cwd: tempDir,
      started_at: Math.floor(Date.now() / 1000) - 10,
      status: 'running',
      stdout_file: path.join(commandsDir, '12345.out'),
      stderr_file: path.join(commandsDir, '12345.err'),
    };
    fs.writeFileSync(
      path.join(commandsDir, '12345.json'),
      JSON.stringify(meta),
    );

    // Mock process.kill to return true for pid 12345 (running)
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid) => {
      if (pid === 12345) return true;
      throw new Error('Process not found');
    });

    const provider = new BackgroundProcessProvider(tempDir, { envPath });
    const output = provider.provide();

    expect(output).not.toBeNull();
    expect(output).toContain('Active Background Processes');
    expect(output).toContain('PID**: 12345');
    expect(output).toContain('Command**: `npm run dev`');
    expect(output).toContain(
      '[STDOUT]\nserver started\nlistening on port 3000',
    );
    expect(output).toContain('[STDERR]\nsome warning');

    killSpy.mockRestore();
  });

  it('should update status to finished when a tracked process has exited', () => {
    const jsonPath = path.join(commandsDir, '54321.json');
    const meta = {
      pid: 54321,
      command: 'exit 0',
      cwd: tempDir,
      started_at: Math.floor(Date.now() / 1000) - 100,
      status: 'running',
    };
    fs.writeFileSync(jsonPath, JSON.stringify(meta));

    // Mock process.kill to throw ESRCH (process not found)
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      const err = new Error('ESRCH') as any;
      err.code = 'ESRCH';
      throw err;
    });

    const provider = new BackgroundProcessProvider(tempDir, { envPath });
    const output = provider.provide();

    // Since process is dead, provide() should return null (no active processes)
    expect(output).toBeNull();

    // Verify metadata was updated on disk
    const updatedMeta = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    expect(updatedMeta.status).toBe('finished');
    expect(updatedMeta.ended_at).toBeDefined();

    killSpy.mockRestore();
  });
});
