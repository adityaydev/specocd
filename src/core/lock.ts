import { mkdirSync, rmSync, statSync } from "node:fs";

/** Directory creation is atomic on every platform, so it doubles as the lock primitive. */
const RETRY_MS = 20;
const DEFAULT_TIMEOUT_MS = 5000;
/** A crashed process leaves its lock behind; break it once it is clearly abandoned. */
const STALE_LOCK_MS = 30_000;

export class LockTimeoutError extends Error {
  constructor(lockDir: string, timeoutMs: number) {
    super(
      `Timed out after ${timeoutMs}ms waiting for ${lockDir}. Another SpecOCD command is ` +
        "holding it. If nothing else is running, delete that directory and retry.",
    );
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Serialises a read-modify-write across processes. Claims are the product's core
 * guarantee, so the whole load/mutate/save cycle has to be one critical section:
 * without it two agents can each read, each add a claim, and the second write
 * silently discards the first.
 */
export function withLock<T>(lockDir: string, fn: () => T, timeoutMs = DEFAULT_TIMEOUT_MS): T {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    try {
      mkdirSync(lockDir);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;

      try {
        if (Date.now() - statSync(lockDir).mtimeMs > STALE_LOCK_MS) {
          rmSync(lockDir, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue; // Lock vanished between the check and the stat; try to take it.
      }

      if (Date.now() > deadline) throw new LockTimeoutError(lockDir, timeoutMs);
      sleepSync(RETRY_MS);
    }
  }

  try {
    return fn();
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}
