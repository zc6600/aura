export class AuraError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

// LLM Errors
export class LLMError extends AuraError {}
export class LLMTimeoutError extends LLMError {}
export class LLMAuthError extends LLMError {}
export class LLMRateLimitError extends LLMError {}
export class LLMServerError extends LLMError {}
export class LLMBadRequestError extends LLMError {}
export class StreamAbortedError extends Error {
  constructor(public readonly originalError: Error) {
    super(originalError.message);
    this.name = 'StreamAbortedError';
  }
}

// Tool Errors
export class ToolError extends AuraError {}
export class ToolBlockedError extends ToolError {
  constructor(
    message: string,
    public readonly toolName?: string | null,
    public readonly advice?: string | null
  ) {
    super(message);
  }
}

// Loop Errors
export class LoopError extends AuraError {}
export class TooManyFormatErrors extends LoopError {}
export class TooManyToolErrors extends LoopError {}
