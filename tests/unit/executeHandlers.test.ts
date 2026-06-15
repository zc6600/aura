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
import {
  getProcessLogs,
  killProcess,
  listProcesses,
  sendInput,
  subscribeLogs,
} from '../../src/daemon/handlers/execute.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Daemon Execute Handlers', () => {
  const tempDir = path.resolve(__dirname, 'temp-exec-handlers-test');
  const envPath = path.join(tempDir, '.aura');
  const commandsDir = path.join(envPath, 'state', 'commands');

  let mockSocket: any;
  let mockServer: any;

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

    mockSocket = {
      destroyed: false,
      write: vi.fn(),
    };

    mockServer = {
      projectPath: tempDir,
      sendResult: vi.fn(),
      sendError: vi.fn(),
    };

    vi.restoreAllMocks();

    vi.spyOn(process, 'kill').mockImplementation(() => {
      const err = new Error('ESRCH') as any;
      err.code = 'ESRCH';
      throw err;
    });
  });

  describe('listProcesses', () => {
    it('should return empty array if no processes are tracked', async () => {
      const ctx = {
        server: mockServer,
        socket: mockSocket,
        id: 'req-1',
        params: {},
      };

      await listProcesses(ctx);

      expect(mockServer.sendResult).toHaveBeenCalledWith(mockSocket, 'req-1', {
        processes: [],
      });
    });

    it('should list tracked processes and check liveness', async () => {
      // Mock process 11111 (alive) and 22222 (exited)
      const meta1 = {
        pid: 11111,
        command: 'node server.js',
        started_at: 1000,
        status: 'running',
      };
      const meta2 = {
        pid: 22222,
        command: 'npm run test',
        started_at: 2000,
        status: 'running',
      };

      fs.writeFileSync(
        path.join(commandsDir, '11111.json'),
        JSON.stringify(meta1),
      );
      fs.writeFileSync(
        path.join(commandsDir, '22222.json'),
        JSON.stringify(meta2),
      );

      const _killSpy = vi.spyOn(process, 'kill').mockImplementation((pid) => {
        if (pid === 11111) return true;
        const err = new Error('ESRCH') as any;
        err.code = 'ESRCH';
        throw err;
      });

      const ctx = {
        server: mockServer,
        socket: mockSocket,
        id: 'req-2',
        params: {},
      };

      await listProcesses(ctx);

      expect(mockServer.sendResult).toHaveBeenCalled();
      const callArg = mockServer.sendResult.mock.calls[0][2];
      expect(callArg.processes).toHaveLength(2);

      const p11111 = callArg.processes.find((p: any) => p.pid === 11111);
      const p22222 = callArg.processes.find((p: any) => p.pid === 22222);

      expect(p11111.status).toBe('running');
      expect(p22222.status).toBe('finished'); // status updated to finished
    });
  });

  describe('getProcessLogs', () => {
    it('should fail if pid parameter is missing', async () => {
      const ctx = {
        server: mockServer,
        socket: mockSocket,
        id: 'req-3',
        params: {},
      };

      await getProcessLogs(ctx);

      expect(mockServer.sendError).toHaveBeenCalledWith(
        mockSocket,
        'req-3',
        -32602,
        expect.stringContaining('pid'),
      );
    });

    it('should retrieve stdout and stderr logs', async () => {
      const pid = 33333;
      const meta = {
        pid,
        command: 'echo test',
        started_at: 5000,
        status: 'running',
        stdout_file: path.join(commandsDir, `${pid}.out`),
        stderr_file: path.join(commandsDir, `${pid}.err`),
      };

      fs.writeFileSync(
        path.join(commandsDir, `${pid}.json`),
        JSON.stringify(meta),
      );
      fs.writeFileSync(meta.stdout_file, 'output line 1\noutput line 2\n');
      fs.writeFileSync(meta.stderr_file, 'error trace\n');

      const ctx = {
        server: mockServer,
        socket: mockSocket,
        id: 'req-4',
        params: { pid },
      };

      await getProcessLogs(ctx);

      expect(mockServer.sendResult).toHaveBeenCalledWith(mockSocket, 'req-4', {
        pid,
        status: 'finished', // process.kill throws ESRCH because pid is mock
        command: 'echo test',
        stdout: 'output line 1\noutput line 2\n',
        stderr: 'error trace\n',
      });
    });
  });

  describe('killProcess', () => {
    it('should fail for invalid signal parameter', async () => {
      const ctx = {
        server: mockServer,
        socket: mockSocket,
        id: 'req-5',
        params: { pid: 44444, signal: 'SIGFAKE' },
      };

      await killProcess(ctx);

      expect(mockServer.sendError).toHaveBeenCalledWith(
        mockSocket,
        'req-5',
        -32602,
        expect.stringContaining('signal'),
      );
    });

    it('should call process.kill and update status on disk', async () => {
      const pid = 44444;
      const jsonPath = path.join(commandsDir, `${pid}.json`);
      const meta = {
        pid,
        command: 'node long-run.js',
        started_at: 6000,
        status: 'running',
      };
      fs.writeFileSync(jsonPath, JSON.stringify(meta));

      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

      const ctx = {
        server: mockServer,
        socket: mockSocket,
        id: 'req-6',
        params: { pid, signal: 'SIGTERM' },
      };

      await killProcess(ctx);

      expect(killSpy).toHaveBeenCalledWith(pid, 'SIGTERM');
      expect(mockServer.sendResult).toHaveBeenCalledWith(mockSocket, 'req-6', {
        success: true,
        pid,
        signal: 'SIGTERM',
      });

      const updated = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      expect(updated.status).toBe('killed');
      expect(updated.ended_at).toBeDefined();
    });
  });

  describe('subscribeLogs', () => {
    it('should fail if pid parameter is missing', async () => {
      const ctx = {
        server: mockServer,
        socket: mockSocket,
        id: 'req-7',
        params: {},
      };

      await subscribeLogs(ctx);

      expect(mockServer.sendError).toHaveBeenCalledWith(
        mockSocket,
        'req-7',
        -32602,
        expect.stringContaining('pid'),
      );
    });

    it('should tail files and monitor metadata changes', async () => {
      const pid = 55555;
      const jsonPath = path.join(commandsDir, `${pid}.json`);
      const outPath = path.join(commandsDir, `${pid}.out`);
      const errPath = path.join(commandsDir, `${pid}.err`);

      const meta = {
        pid,
        command: 'node long-run.js',
        started_at: Date.now() / 1000,
        status: 'running',
        stdout_file: outPath,
        stderr_file: errPath,
      };

      fs.writeFileSync(jsonPath, JSON.stringify(meta));
      fs.writeFileSync(outPath, 'stdout line 1\n');
      fs.writeFileSync(errPath, 'stderr line 1\n');

      const ctx = {
        server: mockServer,
        socket: {
          destroyed: false,
          write: vi.fn(),
          on: vi.fn(),
        },
        id: 'req-8',
        params: { pid },
      } as any;

      await subscribeLogs(ctx);

      expect(mockServer.sendResult).toHaveBeenCalledWith(ctx.socket, 'req-8', {
        subscribed: true,
        pid,
      });

      // Verify it sends the initial lines
      const writeMock = ctx.socket.write;
      expect(writeMock).toHaveBeenCalled();

      const calls = writeMock.mock.calls.map((c: any) =>
        JSON.parse(c[0].trim()),
      );
      const stdoutLog = calls.find(
        (c: any) =>
          c.method === 'execute/onLog' && c.params.stream === 'stdout',
      );
      const stderrLog = calls.find(
        (c: any) =>
          c.method === 'execute/onLog' && c.params.stream === 'stderr',
      );

      expect(stdoutLog.params.line).toBe('stdout line 1');
      expect(stderrLog.params.line).toBe('stderr line 1');
    });
  });

  describe('sendInput', () => {
    it('should fail if pid parameter is missing', async () => {
      const ctx = {
        server: mockServer,
        socket: mockSocket,
        id: 'req-send-1',
        params: { input: 'yes' },
      };

      await sendInput(ctx);

      expect(mockServer.sendError).toHaveBeenCalledWith(
        mockSocket,
        'req-send-1',
        -32602,
        expect.stringContaining('pid'),
      );
    });

    it('should fail if input parameter is missing or not a string', async () => {
      const ctx = {
        server: mockServer,
        socket: mockSocket,
        id: 'req-send-2',
        params: { pid: 123 },
      };

      await sendInput(ctx);

      expect(mockServer.sendError).toHaveBeenCalledWith(
        mockSocket,
        'req-send-2',
        -32602,
        expect.stringContaining('input'),
      );
    });

    it('should fail if there is no active runner', async () => {
      const ctx = {
        server: mockServer,
        socket: mockSocket,
        id: 'req-send-3',
        params: { pid: 123, input: 'yes' },
      };

      await sendInput(ctx);

      expect(mockServer.sendError).toHaveBeenCalledWith(
        mockSocket,
        'req-send-3',
        -32603,
        expect.stringContaining('runner'),
      );
    });

    it('should invoke execute on runner engine and send result', async () => {
      const mockEngine = {
        execute: vi
          .fn()
          .mockResolvedValue({ status: 'ok', message: 'Input sent' }),
      };
      mockServer.runner = {
        getEngine: () => mockEngine,
      };

      const ctx = {
        server: mockServer,
        socket: mockSocket,
        id: 'req-send-4',
        params: { pid: 123, input: 'yes' },
      };

      await sendInput(ctx);

      expect(mockEngine.execute).toHaveBeenCalledWith('send_process_input', {
        pid: 123,
        input: 'yes',
      });
      expect(mockServer.sendResult).toHaveBeenCalledWith(
        mockSocket,
        'req-send-4',
        {
          status: 'ok',
          message: 'Input sent',
        },
      );
    });
  });
});
