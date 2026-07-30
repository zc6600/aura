import { Bridge } from '../../core/interface/bridge.js';
import type { PauseSignal } from '../../core/kernel/agentLoop.js';
import {
  checkpointPath,
  clearCheckpoint,
  type LoopCheckpoint,
  loadCheckpoint,
  saveCheckpoint,
} from '../../core/kernel/checkpoint.js';
import { RalphLoop } from '../../core/kernel/ralphLoop.js';
import { Runner } from '../../core/kernel/runner.js';
import type { HandlerFunction } from '../router.js';

/**
 * Asks the running loop to park itself at its next step boundary.
 *
 * Only the client that owns the job may pause it — mirroring the identity
 * check on disconnect-abort, so a second shell watching the same daemon
 * cannot suspend someone else's run.
 */
export const pause: HandlerFunction = async (ctx) => {
  const server = ctx.server;
  if (server.activeLoopJob.status !== 'running') {
    server.sendError(ctx.socket, ctx.id, -32603, 'No goal loop is running.');
    return;
  }
  if (server.activeJobSocket !== ctx.socket) {
    server.sendError(
      ctx.socket,
      ctx.id,
      -32603,
      'Only the client that started the goal loop can pause it.',
    );
    return;
  }
  if (!server.activePauseSignal) {
    server.sendError(
      ctx.socket,
      ctx.id,
      -32603,
      'The running loop does not support pausing (Ralph mode). Disconnect to abort it.',
    );
    return;
  }
  server.activePauseSignal.requested = true;
  server.sendResult(ctx.socket, ctx.id, { pausing: true });
};

export const runGoal: HandlerFunction = async (ctx) => {
  const server = ctx.server;
  if (!server.runner) {
    server.runner = new Runner(server.projectPath, {
      watcher: server.getOrCreateWatcher(),
    });
  }
  const engine = server.runner.getEngine();
  if (engine.listenerCount('interactive_prompt') === 0) {
    engine.on('interactive_prompt', (event: unknown) => {
      server.sendNotification('execute/onInteractivePrompt', event);
    });
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
  const { mode, options } = p || {};
  const cpPath = checkpointPath(
    server.projectPath,
    server.runner.sessionName || 'default',
  );

  // Resuming reads the goal back off the checkpoint, so the client does not
  // have to remember (or re-type) what it was working on.
  let resumeCheckpoint: LoopCheckpoint | null = null;
  let goal: string;
  if (p?.resume) {
    resumeCheckpoint = loadCheckpoint(cpPath);
    if (!resumeCheckpoint) {
      server.sendError(
        ctx.socket,
        ctx.id,
        -32602,
        `No suspended run to resume in session '${server.runner.sessionName || 'default'}'.`,
      );
      return;
    }
    goal = resumeCheckpoint.goal;
  } else {
    if (!p?.goal || typeof p.goal !== 'string') {
      server.sendError(ctx.socket, ctx.id, -32602, 'Invalid goal parameter.');
      return;
    }
    goal = p.goal;
  }

  server.activeLoopJob = {
    status: 'running',
    goal,
    mode: mode as string | undefined,
  };
  server.clearIdleTimer();

  server.activeAbortController = new AbortController();
  server.activeJobSocket = ctx.socket;
  // Ralph tears down its per-step sessions on exit, so it has nothing
  // resumable to park; leaving the signal null makes agent/pause reject
  // with an explanation rather than silently doing nothing.
  const pauseSignal: PauseSignal | null =
    mode === 'ralph' ? null : { requested: false };
  server.activePauseSignal = pauseSignal;
  const signal = server.activeAbortController.signal;
  server.runner.abortSignal = signal;

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
      const result = await ralph.run();
      server.sendResult(ctx.socket, ctx.id, result);
    } else {
      const bridge = new Bridge(server.projectPath, {
        runner: server.runner,
      });

      let final_content: string | undefined;
      let status: 'completed' | 'failed' | 'suspended' = 'completed';

      let waitingTimer: ReturnType<typeof setInterval> | null = null;
      const clearWaitingTimer = () => {
        if (waitingTimer) {
          clearInterval(waitingTimer);
          waitingTimer = null;
        }
      };

      bridge.on('on_final_answer', (content: string) => {
        final_content = content;
      });
      bridge.on(
        'on_waiting',
        (startTimeMs: number, streamedCheck: () => boolean) => {
          clearWaitingTimer();
          const sendElapsed = () => {
            server.sendNotification('agent/onProgress', {
              type: 'waiting',
              payload: { elapsed: (Date.now() - startTimeMs) / 1000 },
            });
          };
          sendElapsed();
          // Keep re-sending on an interval so the client's elapsed-time
          // display keeps advancing while waiting for the first token,
          // instead of being stuck at the ~0s value from the call above.
          waitingTimer = setInterval(() => {
            if (streamedCheck()) {
              clearWaitingTimer();
              return;
            }
            sendElapsed();
          }, 500);
        },
      );
      bridge.on('on_clear_waiting', () => {
        clearWaitingTimer();
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
        clearWaitingTimer();
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

      let suspendedAt: number | null = null;

      try {
        await bridge.chat(goal, {
          auto_mode: isAuto as boolean,
          max_steps: optionsRecord.max_steps as number | undefined,
          pauseSignal,
          checkpoint: resumeCheckpoint,
        });
        const result = bridge.lastResult;
        if (result) {
          status = result.status;
          if (
            result.final_content !== undefined &&
            result.final_content !== null
          ) {
            final_content = result.final_content;
          }
          // Persist on suspend so the run survives this daemon: the client can
          // disconnect, the daemon can idle out, and /resume still works.
          if (result.status === 'suspended' && result.checkpoint) {
            saveCheckpoint(cpPath, result.checkpoint);
            suspendedAt = result.checkpoint.stepCount;
          } else if (result.status === 'completed') {
            clearCheckpoint(cpPath);
          }
        }
      } catch (_err: unknown) {
        status = 'failed';
      } finally {
        clearWaitingTimer();
      }

      server.sendResult(ctx.socket, ctx.id, {
        status,
        final_content,
        ...(suspendedAt !== null
          ? { stepCount: suspendedAt, goal, resumable: true }
          : {}),
      });
    }
  } finally {
    if (server.runner) {
      server.runner.abortSignal = null;
      server.runner.hooks.unregister('before_planning', disconnectHook);
      server.runner.hooks.unregister('before_tool_execution', disconnectHook);
      server.runner.hooks.unregister('before_tool_execution', confirmHook);
    }
    server.activeLoopJob = { status: 'idle' };
    server.activeAbortController = null;
    server.activeJobSocket = null;
    server.activePauseSignal = null;
    server.resetIdleTimer();
  }
};
