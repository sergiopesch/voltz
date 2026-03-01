/**
 * SilentError — thrown when a command has already printed a user-friendly
 * error message. The CLI entry point catches this and exits with code 1
 * without printing anything extra (no duplicate error output).
 */
export class SilentError extends Error {
  readonly silent = true as const;

  constructor(cause?: Error) {
    super(cause?.message ?? "");
    this.name = "SilentError";
    if (cause) this.cause = cause;
  }
}

export function isSilentError(err: unknown): err is SilentError {
  return err instanceof SilentError;
}
