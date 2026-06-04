import readline from 'node:readline';
import picocolors from 'picocolors';

export class ConsoleRenderer {
  private verbose: boolean;
  private lastStreamed = false;

  constructor(options: { verbose?: boolean } = {}) {
    this.verbose = options.verbose || false;
  }

  public onToken(text: string): void {
    if (!this.lastStreamed) {
      this.lastStreamed = true;
      process.stdout.write('\r\x1b[K'); // Clear waiting line
    }
    process.stdout.write(text);
  }

  public onStreamEnd(): void {
    if (this.lastStreamed) {
      process.stdout.write('\n');
    }
    this.lastStreamed = false;
  }

  public onWaiting(elapsedSeconds: number): void {
    process.stdout.write(`\r⏳ Waiting for response... (${elapsedSeconds.toFixed(1)}s)`);
  }

  public onClearWaiting(): void {
    process.stdout.write('\r\x1b[K');
  }

  public onToolStart(tool: string, summary?: string | null, args?: any): void {
    console.log(`\n>> 🔧 Tool: ${picocolors.cyan(tool)}`);
    if (summary && summary.trim()) {
      console.log(`   🧾 Summary: ${summary.trim()}`);
    }
    if (this.verbose && args && Object.keys(args).length > 0) {
      console.log(`   🧩 Args: ${this.formatArgs(args)}`);
    }
  }

  public onToolExecuting(): void {
    console.log('   🚀 Executing...');
  }

  public onToolResult(result: any): void {
    const status = result?.status;
    let statusColor = picocolors.yellow;
    if (status === 'ok' || status === 'success') {
      statusColor = picocolors.green;
    } else if (status === 'failed' || status === 'blocked') {
      statusColor = picocolors.red;
    }

    console.log(`   ${statusColor(`✓ Status: ${status}`)}`);

    const output = result?.output ?? result?.content ?? result?.stdout ?? result?.message;
    if (output && output.toString().trim()) {
      let outputStr = output.toString().trim();
      if (outputStr.length > 200) {
        outputStr = outputStr.substring(0, 197) + '...';
      }
      const firstLine = outputStr.split('\n')[0]?.trim() || outputStr;
      if (firstLine) {
        console.log(`   📄 ${firstLine}`);
      }
    }

    const modified = result?.modified_files;
    if (Array.isArray(modified) && modified.length > 0) {
      console.log('   📝 Modified files:');
      for (const file of modified) {
        console.log(`      • ${file}`);
      }
    }
  }

  public onThought(thought: string, elapsed?: number | null): void {
    if (elapsed !== undefined && elapsed !== null) {
      console.log(`\n>> 💬 Response (${this.formatDuration(elapsed)}):`);
    } else {
      console.log('\n>> 💬 Response:');
    }
    console.log(thought);
  }

  public onError(message: string): void {
    console.error(`\n>> ${picocolors.red(`⚠️  Error: ${message}`)}`);
  }

  public onWarning(message: string): void {
    console.warn(`\n>> ${picocolors.yellow(`⚠️  ${message}`)}`);
  }

  public askConfirmation(message: string): Promise<boolean> {
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      rl.question(`   ⚠️  ${message} [y/N] `, (answer) => {
        rl.close();
        resolve(answer.trim().toLowerCase() === 'y');
      });
    });
  }

  private formatDuration(seconds: number): string {
    if (seconds < 60) {
      return `${seconds.toFixed(1)}s`;
    }
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}m ${s}s`;
  }

  private formatArgs(args: any): string {
    try {
      const json = JSON.stringify(args);
      if (json.length > 100) {
        return json.substring(0, 97) + '...';
      }
      return json;
    } catch {
      return String(args);
    }
  }
}
