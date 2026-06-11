import * as clack from '@clack/prompts';
import picocolors from 'picocolors';

// ---------------------------------------------------------------------------
// Custom Exception Classes for Programmatic/CLI separation
// ---------------------------------------------------------------------------

export class CliError extends Error {
  public readonly exitCode: number;
  public readonly tip?: string;

  constructor(message: string, exitCode = 1, tip?: string) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
    this.tip = tip;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class WorkspaceError extends CliError {
  constructor(
    message: string,
    tip = 'run `aura new .` to initialize a workspace in the current directory.',
  ) {
    super(message, 1, tip);
    this.name = 'WorkspaceError';
  }
}

export class SessionError extends CliError {
  constructor(
    message: string,
    tip = 'run `aura session list` to see available sessions.',
  ) {
    super(message, 1, tip);
    this.name = 'SessionError';
  }
}

export class ToolError extends CliError {
  constructor(message: string, exitCode = 2, tip?: string) {
    super(message, exitCode, tip);
    this.name = 'ToolError';
  }
}

export class SkillError extends CliError {
  constructor(message: string, exitCode = 2, tip?: string) {
    super(message, exitCode, tip);
    this.name = 'SkillError';
  }
}

// ---------------------------------------------------------------------------
// Consolidated Color Logger Utilities
// ---------------------------------------------------------------------------

export function printError(msg: string): void {
  console.error(picocolors.red(`⛔️ Error: ${msg}`));
}

export function printSuccess(msg: string): void {
  console.log(picocolors.green(`✓ ${msg}`));
}

export function printWarning(msg: string): void {
  console.warn(picocolors.yellow(`⚠️  ${msg}`));
}

export function printInfo(msg: string): void {
  console.log(picocolors.blue(`ℹ️ ${msg}`));
}

// ---------------------------------------------------------------------------
// Standard prompts (readline fallback)
// ---------------------------------------------------------------------------

/**
 * Prompts the user with a y/N question and returns true if they answer yes.
 * Automatically falls back to default in non-interactive or test environments.
 */
export async function confirm(
  question: string,
  defaultValue = false,
): Promise<boolean> {
  // If not a TTY or running in CI/Test, fall back to default
  if (
    !process.stdin.isTTY ||
    process.env.NODE_ENV === 'test' ||
    process.env.CI === 'true'
  ) {
    return defaultValue;
  }

  const result = await clack.confirm({
    message: question,
    initialValue: defaultValue,
  });

  if (clack.isCancel(result)) {
    return false;
  }

  return result;
}

/**
 * Prompts for text input from the console.
 */
export async function prompt(message: string): Promise<string> {
  if (
    !process.stdin.isTTY ||
    process.env.NODE_ENV === 'test' ||
    process.env.CI === 'true'
  ) {
    return '';
  }

  const result = await clack.text({
    message,
  });

  if (clack.isCancel(result)) {
    return '';
  }

  return result;
}

// ---------------------------------------------------------------------------
// Clack-based visual prompts & spinners
// ---------------------------------------------------------------------------

export function isCancel(value: unknown): value is symbol {
  return clack.isCancel(value);
}

export function showSpinner(message: string) {
  const s = clack.spinner();
  s.start(message);
  return s;
}

export async function selectPrompt<T>(
  message: string,
  options: { value: T; label: string; hint?: string }[],
  initialValue?: T,
): Promise<T | symbol> {
  return (await clack.select({
    message,
    options: options as any,
    initialValue,
  })) as T | symbol;
}

export async function multilinePrompt(
  message: string,
  placeholder?: string,
): Promise<string | symbol> {
  return (await clack.multiline({
    message,
    placeholder,
  })) as string | symbol;
}
