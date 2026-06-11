import { Bridge } from '../../core/interface/bridge.js';
import { RalphLoop } from '../../core/kernel/ralphLoop.js';
import { Runner } from '../../core/kernel/runner.js';
import type { HandlerFunction } from '../router.js';

export const runGoal: HandlerFunction = async (ctx) => {
  const server = ctx.server;
  if (!server.runner) {
    server.runner = new Runner(server.projectPath);
  }
  if (server.activeLoopJob.status === 'running') {
    server.sendError(
      ctx.socket,
      ctx.id,
      -32603,
      'Daemon is already running a goal loop.',
    );
    return;
  }

  const p = ctx.params as Record<string, unknown> | null | undefined;
  const { goal, mode, options } = p || {};
  if (!goal || typeof goal !== 'string') {
    server.sendError(ctx.socket, ctx.id, -32602, 'Invalid goal parameter.');
    return;
  }

  server.activeLoopJob = {
    status: 'running',
    goal,
    mode: mode as string | undefined,
  };
  server.clearIdleTimer();

  server.activeAbortController = new AbortController();
  server.activeJobSocket = ctx.socket;
  const signal = server.activeAbortController.signal;

  const disconnectHook = () => {
    if (signal.aborted || ctx.socket.destroyed) {
      throw new Error('Client socket disconnected');
    }
    return true;
  };

  const confirmHook = async (tool: unknown, _args: unknown) => {
    const runner = server.runner;
    if (!runner) {
      return true;
    }
    const config = runner.loadConfig();
    const security = config?.security as Record<string, unknown> | undefined;
    const confirmEnabled = security?.confirm_dangerous_tools === true;

    if (!confirmEnabled) {
      return true;
    }

    const isAutoJob = runner.currentJob?.metadata?.auto_mode || false;
    if (isAutoJob) {
      return true;
    }
    const dangerousTools = ['write_file', 'bash_command'];
    if (dangerousTools.includes(String(tool))) {
      return await server.askClientConfirmation(
        ctx.socket,
        `DANGEROUS TOOL: ${tool}. Execute?`,
      );
    }
    return true;
  };

  server.runner.hooks.register('before_planning', disconnectHook);
  server.runner.hooks.register('before_tool_execution', disconnectHook);
  server.runner.hooks.register('before_tool_execution', confirmHook);

  const eventBus = {
    emit: (ev: string, data?: unknown) => {
      server.sendNotification('agent/onProgress', {
        type: ev,
        payload: data,
      });
    },
  };

  try {
    if (mode === 'ralph') {
      const ralph = new RalphLoop(server.runner, goal, {
        ...((options as Record<string, unknown>) || {}),
        eventBus,
        signal,
      });
      const status = await ralph.run();
      server.sendResult(ctx.socket, ctx.id, { status });
    } else {
      const bridge = new Bridge(server.projectPath, {
        runner: server.runner,
      });

      let final_content: string | undefined;
      let status: 'completed' | 'failed' = 'completed';

      bridge.on('on_final_answer', (content: string) => {
        final_content = content;
      });
      bridge.on(
        'on_waiting',
        (startTimeMs: number, _streamedCheck: () => boolean) => {
          server.sendNotification('agent/onProgress', {
            type: 'waiting',
            payload: { elapsed: (Date.now() - startTimeMs) / 1000 },
          });
        },
      );
      bridge.on('on_clear_waiting', () => {
        server.sendNotification('agent/onProgress', {
          type: 'clear_waiting',
          payload: {},
        });
      });
      bridge.on('on_token', (token: string) => {
        server.sendNotification('agent/onProgress', {
          type: 'token',
          payload: { text: token },
        });
      });
      bridge.on('on_stream_end', () => {
        server.sendNotification('agent/onProgress', {
          type: 'stream_end',
          payload: {},
        });
      });
      bridge.on(
        'on_tool_start',
        (tool: string, summary?: string | null, args?: unknown) => {
          server.sendNotification('agent/onProgress', {
            type: 'tool_start',
            payload: { tool, summary, args },
          });
        },
      );
      bridge.on('on_tool_executing', () => {
        server.sendNotification('agent/onProgress', {
          type: 'tool_executing',
          payload: {},
        });
      });
      bridge.on('on_tool_result', (result: unknown) => {
        server.sendNotification('agent/onProgress', {
          type: 'tool_result',
          payload: { result },
        });
      });
      bridge.on('on_warning', (msg: string) => {
        server.sendNotification('agent/onProgress', {
          type: 'warning',
          payload: { message: msg },
        });
      });
      bridge.on('on_error', (msg: string) => {
        server.sendNotification('agent/onProgress', {
          type: 'error',
          payload: { message: msg },
        });
        status = 'failed';
      });
      bridge.on('on_thought', (thought: string, elapsed?: number | null) => {
        server.sendNotification('agent/onProgress', {
          type: 'thought',
          payload: { content: thought, duration: elapsed },
        });
      });

      const optionsRecord = (options as Record<string, unknown>) || {};
      const isAuto =
        optionsRecord.auto_mode !== undefined ? optionsRecord.auto_mode : true;

      try {
        await bridge.chat(goal, { auto_mode: isAuto as boolean });
      } catch (_err: unknown) {
        status = 'failed';
      }

      server.sendResult(ctx.socket, ctx.id, { status, final_content });
    }
  } finally {
    if (server.runner) {
      server.runner.hooks.unregister('before_planning', disconnectHook);
      server.runner.hooks.unregister('before_tool_execution', disconnectHook);
      server.runner.hooks.unregister('before_tool_execution', confirmHook);
    }
    server.activeLoopJob = { status: 'idle' };
    server.activeAbortController = null;
    server.activeJobSocket = null;
    server.resetIdleTimer();
  }
};
