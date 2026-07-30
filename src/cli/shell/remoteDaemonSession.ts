import path from 'node:path';
import readline from 'node:readline';
import picocolors from 'picocolors';
import {
  checkpointPath,
  loadCheckpoint,
} from '../../core/kernel/checkpoint.js';
import { SessionManager } from '../../core/memory/sessionManager.js';
import type { DaemonClient } from '../../daemon/client.js';
import { Dashboard } from '../commands/dashboard.js';
import * as UI from '../ui.js';
import { ConsoleRenderer } from './consoleRenderer.js';

export class RemoteDaemonSession {
  private projectPath: string;
  private options: Record<string, unknown>;
  private sessionMgr: SessionManager;
  private auto = true;

  constructor(projectPath: string, options: Record<string, unknown> = {}) {
    this.projectPath = path.resolve(projectPath);
    this.options = options;
    this.sessionMgr = new SessionManager(this.projectPath);
  }

  public async start(): Promise<void> {
    const mode = (this.options.mode as string) || 'classic';
    const goal = this.options.goal as string;

    const { DaemonClient } = await import('../../daemon/client.js');
    const client = new DaemonClient(this.projectPath);
    await client.connect();

    const currentSession = this.sessionMgr.currentName();
    await client.request('workspace/initialize', {
      sessionName: currentSession,
    });

    const renderer = new ConsoleRenderer({
      verbose: this.options.verbose as boolean,
    });

    client.onConfirmRequest(async (msg) => {
      return await renderer.askConfirmation(msg);
    });

    this.announceSuspendedRun(currentSession);

    if (goal && goal.trim().length > 0) {
      client.onNotification((method, params) => {
        if (method === 'agent/onProgress') {
          const { type, payload } = params as {
            type: string;
            payload: Record<string, unknown>;
          };
          this.handleProgressNotification(renderer, type, payload);
        }
      });

      try {
        const res = await client.request('agent/runGoal', {
          goal,
          mode,
          options: {
            auto_mode: true,
            max_steps: this.options.max_steps,
            verify_command: this.options.verify,
            critic: this.options.critic,
            critic_mode: this.options.critic_mode,
          },
        });
        if (res.status !== 'completed') {
          throw new UI.CliError('Agent run did not complete successfully.');
        }
      } finally {
        client.disconnect();
      }
      return;
    }

    // Interactive loop via Daemon
    try {
      if (!goal || goal.trim().length === 0) {
        // Read config via Daemon workspace or fallback
        new Dashboard(this.projectPath, {}, 'daemon').render();
      }
      await this.runLoopWithDaemon(client, renderer);
    } finally {
      client.disconnect();
    }
  }

  private async runLoopWithDaemon(
    client: DaemonClient,
    renderer: ConsoleRenderer,
  ): Promise<void> {
    const removeListener = client.onNotification(
      (method: string, params: Record<string, unknown>) => {
        if (method === 'agent/onProgress') {
          const { type, payload } = params as {
            type: string;
            payload: Record<string, unknown>;
          };
          this.handleProgressNotification(renderer, type, payload);
        }
      },
    );

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      historySize: 1000,
    });

    let isClosed = false;
    rl.on('close', () => {
      isClosed = true;
    });

    let goalRunning = false;
    let pauseRequested = false;
    rl.on('SIGINT', () => {
      if (goalRunning) {
        if (pauseRequested) {
          console.log(
            picocolors.yellow('\n⏹  Forcing shutdown (run will not be saved).'),
          );
          rl.close();
        } else {
          pauseRequested = true;
          console.log(
            picocolors.yellow(
              '\n⏸  Pause requested. Finishing in-flight tool and saving checkpoint... (Press ^C again to force exit)',
            ),
          );
          client.request('agent/pause', {}).catch(() => {});
        }
      } else if (rl.line.length > 0) {
        process.stdout.write('\n');
        rl.prompt();
      } else {
        rl.close();
      }
    });

    const promptStr = `${picocolors.cyan(picocolors.bold('aura'))} ${picocolors.gray('›')} `;

    const askQuestion = (): Promise<string | null> => {
      return new Promise((resolve) => {
        const onClose = () => resolve(null);
        rl.once('close', onClose);
        rl.question(promptStr, (answer) => {
          rl.off('close', onClose);
          resolve(answer);
        });
      });
    };

    try {
      while (!isClosed) {
        const inputVal = await askQuestion();
        if (inputVal === null) {
          console.log('\nBye!');
          break;
        }

        const input = inputVal.trim();
        if (!input) {
          continue;
        }

        if (
          ['exit', 'quit', '/exit', '/quit', '/q'].includes(input.toLowerCase())
        ) {
          console.log('Bye!');
          break;
        }

        if (
          ['auto on', '/auto on'].includes(
            input.toLowerCase().replace(/\s+/g, ' '),
          )
        ) {
          this.auto = true;
          console.log('Auto mode: ON');
          continue;
        }
        if (
          ['auto off', '/auto off'].includes(
            input.toLowerCase().replace(/\s+/g, ' '),
          )
        ) {
          this.auto = false;
          console.log('Auto mode: OFF (Interactive Mode)');
          continue;
        }
        if (['auto', '/auto'].includes(input.toLowerCase())) {
          console.log(
            'Usage: /auto on/off (Toggle auto-pilot/interactive mode)',
          );
          continue;
        }

        goalRunning = true;
        pauseRequested = false;
        try {
          const res = await client.request('agent/runTurn', {
            input,
            options: {
              auto_mode: this.auto,
              max_steps: this.options.max_steps,
            },
          });
          if (res.status === 'suspended') {
            console.log(
              picocolors.yellow(
                '\n⏸  Run paused. Checkpoint saved — run `aura resume` to continue later.',
              ),
            );
          }
        } catch (e: unknown) {
          console.error(
            picocolors.red(
              `⛔️ Error processing command: ${(e as Error).message}`,
            ),
          );
        } finally {
          goalRunning = false;
          pauseRequested = false;
        }
      }
    } finally {
      removeListener();
      if (!isClosed) {
        rl.close();
      }
    }
  }

  private handleProgressNotification(
    renderer: ConsoleRenderer,
    type: string,
    payload: Record<string, unknown>,
  ): void {
    switch (type) {
      case 'on_token':
        renderer.onToken(payload.token as string);
        break;
      case 'on_stream_end':
        renderer.onStreamEnd();
        break;
      case 'on_thought':
        renderer.onThought(
          payload.thought as string,
          payload.elapsed as number | null,
        );
        break;
      case 'on_tool_start':
        renderer.onToolStart(
          payload.tool as string,
          payload.summary as string | undefined,
          payload.args as Record<string, unknown> | undefined,
        );
        break;
      case 'on_tool_executing':
        renderer.onToolExecuting();
        break;
      case 'on_tool_result':
        renderer.onToolResult(payload.result as never);
        break;
      case 'on_warning':
        renderer.onWarning(payload.message as string);
        break;
      case 'on_error':
        renderer.onError(payload.message as string);
        break;
    }
  }

  private announceSuspendedRun(sessionName: string): void {
    const cpFile = checkpointPath(this.projectPath, sessionName);
    const cp = loadCheckpoint(cpFile);
    if (!cp) return;

    console.log(
      picocolors.yellow(
        `\n⏸  Found a suspended run from ${new Date(cp.updated_at).toLocaleString()} (` +
          `${cp.completed_steps.length} step${cp.completed_steps.length === 1 ? '' : 's'} completed).`,
      ),
    );
    console.log(
      picocolors.dim(
        `   Resume it anytime by running: ${picocolors.cyan('aura resume')}\n`,
      ),
    );
  }
}
