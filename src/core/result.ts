/**
 * Lightweight Result<T, E> type for typed error propagation.
 *
 * Used internally in kernel/memory/llm layers so errors are not silently
 * swallowed or degraded to plain strings. CLI/tool adapter layers can
 * still flatten to `{ status: 'ok'/'failed' }` for backward compatibility.
 *
 * @example
 *   function divide(a: number, b: number): Result<number, RangeError> {
 *     if (b === 0) return Err(new RangeError('Division by zero'));
 *     return Ok(a / b);
 *   }
 *   const r = divide(10, 0);
 *   if (!r.ok) console.error(r.error.message);
 *   else console.log(r.value);
 */

export type Result<T, E extends Error = Error> =
  | { ok: true;  value: T }
  | { ok: false; error: E };

/** Constructs a successful Result. */
export function Ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/** Constructs a failed Result. */
export function Err<E extends Error>(error: E): Result<never, E> {
  return { ok: false, error };
}

/**
 * Maps the value of a successful Result.
 * Passes errors through unchanged.
 */
export function mapResult<T, U, E extends Error>(
  result: Result<T, E>,
  fn: (value: T) => U
): Result<U, E> {
  if (result.ok) {
    return Ok(fn(result.value));
  }
  return result;
}

/**
 * Unwraps a Result, throwing the error if it failed.
 * Useful at the boundary of code that cannot propagate Results further.
 */
export function unwrap<T, E extends Error>(result: Result<T, E>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

/**
 * Returns the value from a Result, or a fallback if it failed.
 */
export function unwrapOr<T, E extends Error>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}
