import readline from 'node:readline';

/**
 * Prompts the user with a y/N question and returns true if they answer yes.
 * Automatically falls back to default in non-interactive or test environments.
 */
export function confirm(question: string, defaultValue = false): Promise<boolean> {
  return new Promise((resolve) => {
    // If not a TTY or running in CI/Test, fall back to default
    if (!process.stdin.isTTY || process.env.NODE_ENV === 'test' || process.env.CI === 'true') {
      resolve(defaultValue);
      return;
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(`${question} (y/N): `, (answer) => {
      rl.close();
      const response = answer.trim().toLowerCase();
      resolve(['y', 'yes'].includes(response));
    });
  });
}

/**
 * Prompts for text input from the console.
 */
export function prompt(message: string): Promise<string> {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      resolve('');
      return;
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}
