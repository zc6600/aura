import {
  LLMAuthError,
  LLMBadRequestError,
  LLMError,
  LLMRateLimitError,
  LLMServerError,
  LLMTimeoutError,
} from './errors.js';

export class HttpClient {
  /**
   * Makes a POST request and returns the parsed JSON response or streams chunk lines
   */
  public static async post(
    urlStr: string,
    headers: Record<string, string>,
    bodyHash: Record<string, unknown>,
    options: {
      timeout?: number;
      stream?: boolean;
      onChunk?: (chunk: string) => void;
      signal?: AbortSignal;
    } = {},
  ): Promise<Record<string, unknown> | null> {
    const timeoutSeconds = options.timeout ?? 120;
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      timeoutSeconds * 1000,
    );

    const onAbort = () => {
      controller.abort();
    };

    if (options.signal) {
      if (options.signal.aborted) {
        controller.abort();
      } else {
        options.signal.addEventListener('abort', onAbort);
      }
    }

    try {
      const response = await fetch(urlStr, {
        method: 'POST',
        headers,
        body: JSON.stringify(bodyHash),
        signal: controller.signal,
      });

      if (!response.ok) {
        let bodyText = '';
        try {
          bodyText = await response.text();
        } catch {
          // Ignore text reading errors
        }
        HttpClient.validateResponseCode(response.status, bodyText);
      }

      if (options.stream) {
        if (!response.body) {
          throw new LLMError('Response body is null, cannot stream');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          if (options.onChunk) {
            options.onChunk(chunk);
          }
        }
        return null;
      } else {
        const json = await response.json();
        return json as Record<string, unknown>;
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        if (options.signal?.aborted) {
          throw new LLMError(`LLM request aborted: ${err.message}`);
        }
        throw new LLMTimeoutError(`LLM request timed out: ${err.message}`);
      }
      if (err instanceof LLMError) {
        throw err;
      }
      throw new LLMError(`LLM connection failed: ${(err as Error).message}`);
    } finally {
      clearTimeout(timeoutId);
      if (options.signal) {
        options.signal.removeEventListener('abort', onAbort);
      }
    }
  }

  private static validateResponseCode(status: number, bodyText: string): void {
    let errorMessage = bodyText.trim();

    if (errorMessage.length > 0) {
      try {
        const parsed = JSON.parse(errorMessage);
        errorMessage =
          parsed?.error?.message || parsed?.message || errorMessage;
      } catch {
        // Keep original string if not valid JSON
      }
    } else {
      errorMessage = `HTTP Status ${status}`;
    }

    if (status === 401 || status === 403) {
      throw new LLMAuthError(`Authentication failed: ${errorMessage}`);
    } else if (status === 400) {
      if (
        errorMessage.includes('API key not valid') ||
        errorMessage.includes('API_KEY_INVALID')
      ) {
        throw new LLMAuthError(`Authentication failed: ${errorMessage}`);
      } else {
        throw new LLMBadRequestError(`Bad request: ${errorMessage}`);
      }
    } else if (status === 408 || status === 504) {
      throw new LLMTimeoutError(`Request timed out: ${errorMessage}`);
    } else if (status === 429) {
      throw new LLMRateLimitError(`Rate limit exceeded: ${errorMessage}`);
    } else if (status >= 500 && status <= 599) {
      throw new LLMServerError(`Server error (${status}): ${errorMessage}`);
    } else {
      throw new LLMError(`LLM API Error (${status}): ${errorMessage}`);
    }
  }
}
