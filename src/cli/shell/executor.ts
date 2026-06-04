import { Bridge } from '../../core/interface/bridge.js';
import { Runner } from '../../core/kernel/runner.js';
import { ConsoleRenderer } from './consoleRenderer.js';

export class Executor {
  public static readonly DANGEROUS_TOOLS = ['write_file', 'bash_command'];

  private projectPath: string;
  private bridge: Bridge;
  private configLoader: () => any;
  private renderer: ConsoleRenderer;
  private timerInterval?: NodeJS.Timeout;

  constructor(projectPath: string, runner: Runner, configLoader: () => any) {
    this.projectPath = projectPath;
    this.bridge = new Bridge(projectPath, { runner });
    this.configLoader = configLoader;

    const config = this.configLoader();
    this.renderer = new ConsoleRenderer({ verbose: config?.verbose });

    this.setupBridge();
  }

  public async process(input: string, autoMode: boolean): Promise<void> {
    this.killTimer();
    try {
      await this.bridge.chat(input, { auto_mode: autoMode });
    } finally {
      this.killTimer();
    }
  }

  /**
   * Run a single goal non-interactively and return the final answer text
   */
  public async processGoal(goal: string): Promise<string | null> {
    this.killTimer();
    let resultSummary: string | null = null;
    this.bridge.on('on_final_answer', (content: string) => {
      resultSummary = content;
    });

    try {
      await this.bridge.chat(goal, { auto_mode: true });
    } finally {
      this.killTimer();
    }
    return resultSummary;
  }

  private killTimer(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = undefined;
    }
  }

  private setupBridge(): void {
    this.bridge.on('on_waiting', (startTimeMs: number, streamedCheck: () => boolean) => {
      this.startTimer(startTimeMs, streamedCheck);
    });

    this.bridge.on('on_clear_waiting', () => {
      this.killTimer();
      this.renderer.onClearWaiting();
    });

    this.bridge.on('on_token', (token: string) => {
      this.renderer.onToken(token);
    });

    this.bridge.on('on_stream_end', () => {
      this.killTimer();
      this.renderer.onStreamEnd();
    });

    this.bridge.on('on_tool_start', (tool: string, summary?: string | null, args?: any) => {
      this.renderer.onToolStart(tool, summary, args);
    });

    this.bridge.on('on_tool_executing', () => {
      this.renderer.onToolExecuting();
    });

    this.bridge.on('on_tool_result', (result: any) => {
      this.renderer.onToolResult(result);
    });

    this.bridge.on('on_warning', (msg: string) => {
      this.killTimer();
      this.renderer.onWarning(msg);
    });

    this.bridge.on('on_error', (msg: string) => {
      this.killTimer();
      this.renderer.onError(msg);
    });

    this.bridge.on('on_thought', (thought: string, elapsed?: number | null) => {
      this.renderer.onThought(thought, elapsed);
    });

    this.bridge.on('ask_confirmation', async (msg: string) => {
      return await this.renderer.askConfirmation(msg);
    });

    // Register dangerous tool confirmation hook
    this.bridge.registerConfirmationHook(Executor.DANGEROUS_TOOLS);
  }

  private startTimer(startTimeMs: number, streamedCheck: () => boolean): void {
    this.killTimer();
    this.timerInterval = setInterval(() => {
      if (streamedCheck()) {
        this.killTimer();
        return;
      }
      const elapsed = (Date.now() - startTimeMs) / 1000;
      this.renderer.onWaiting(elapsed);
    }, 500);
  }
}
