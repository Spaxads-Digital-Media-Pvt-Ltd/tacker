/** Thrown by `withTimeout` when the wrapped operation doesn't settle in time. */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Race `promise` against a wall-clock limit. Rejects with TimeoutError if it doesn't settle within
 * `ms`; otherwise resolves/rejects exactly as `promise` does. The timer is always cleared, so a fast
 * call leaves nothing pending. (The underlying operation isn't cancelled — callers just stop waiting.)
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new TimeoutError(message)), ms); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
