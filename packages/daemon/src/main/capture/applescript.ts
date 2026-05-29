/**
 * `osascript` runner — plan B2 ("AppleScript polling with timeout/abort").
 *
 * Every AppleScript interaction in WDIOT is a short-lived `osascript`
 * subprocess spawned with a HARD timeout. A hung script (the highest-probability
 * capture failure per the plan's Risks table) cannot stall the capture loop:
 * the subprocess is killed on timeout and the call rejects.
 *
 * The runner also classifies failures so the health state machine
 * (`health.ts`) can distinguish a *persistent* permission denial from a
 * *transient* glitch:
 *   - `denied`    — macOS Automation / Accessibility permission refused.
 *   - `timeout`   — script exceeded the hard timeout (transient).
 *   - `error`     — any other non-zero exit / spawn failure (transient).
 *
 * macOS only.
 */
import { spawn } from 'node:child_process';

/** Default hard timeout for a single `osascript` invocation (ms). */
export const OSASCRIPT_TIMEOUT_MS = 3000;

/** Why an `osascript` invocation failed. */
export type OsascriptFailureKind = 'denied' | 'timeout' | 'error';

/** A failed `osascript` invocation. */
export class OsascriptError extends Error {
  readonly kind: OsascriptFailureKind;
  /** Process exit code, when the process exited (not on spawn failure). */
  readonly exitCode: number | null;
  /** Captured stderr text, trimmed. */
  readonly stderr: string;

  constructor(
    kind: OsascriptFailureKind,
    message: string,
    exitCode: number | null,
    stderr: string,
  ) {
    super(message);
    this.name = 'OsascriptError';
    this.kind = kind;
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

/**
 * Decide whether a given stderr text + exit code indicates a *persistent*
 * macOS permission denial (Automation or Accessibility), as opposed to a
 * transient script error.
 *
 * macOS surfaces permission denials in a few shapes:
 *   - error number `-1743` — "Not authorized to send Apple events".
 *   - error number `-1719` — accompanies some Accessibility refusals.
 *   - the phrase "not allowed" / "Not authorized".
 *   - the phrase "assistive access" (System Events / Accessibility).
 */
export function isPermissionDenied(stderr: string, exitCode: number | null): boolean {
  const text = stderr.toLowerCase();
  if (
    text.includes('-1743') ||
    text.includes('-1719') ||
    text.includes('not authorized') ||
    text.includes('not allowed') ||
    text.includes('assistive access') ||
    text.includes('accessibility access') ||
    text.includes('access for assistive devices')
  ) {
    return true;
  }
  // `osascript` exits 1 on a denied Apple-event send; the stderr text above is
  // the reliable signal, so a bare exit code alone is treated as transient.
  void exitCode;
  return false;
}

/** Options for {@link runOsascript}. */
export interface RunOsascriptOptions {
  /** Hard timeout in ms. Default {@link OSASCRIPT_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Caller-supplied abort signal; aborting kills the subprocess. */
  signal?: AbortSignal;
}

/**
 * Run an AppleScript source string via `osascript -e <script>` and resolve
 * with its trimmed stdout.
 *
 * Rejects with an {@link OsascriptError} on timeout, abort, permission denial,
 * or any other failure. The subprocess is always killed before the returned
 * promise settles, so no `osascript` is left running.
 */
export function runOsascript(
  script: string,
  options: RunOsascriptOptions = {},
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? OSASCRIPT_TIMEOUT_MS;

  return new Promise<string>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new OsascriptError('error', 'aborted before start', null, ''));
      return;
    }

    const child = spawn('osascript', ['-e', script], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const cleanup = (): void => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    };

    // Hard timeout: kill the subprocess so a hung AppleScript cannot stall
    // the capture loop (plan B2 + Risks).
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      cleanup();
      reject(
        new OsascriptError(
          'timeout',
          `osascript exceeded ${timeoutMs}ms hard timeout`,
          null,
          stderr.trim(),
        ),
      );
    }, timeoutMs);

    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      cleanup();
      reject(new OsascriptError('error', 'aborted', null, stderr.trim()));
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new OsascriptError('error', `spawn failed: ${err.message}`, null, ''));
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      const trimmedErr = stderr.trim();
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      if (isPermissionDenied(trimmedErr, code)) {
        reject(
          new OsascriptError(
            'denied',
            `osascript permission denied: ${trimmedErr || 'no detail'}`,
            code,
            trimmedErr,
          ),
        );
        return;
      }
      reject(
        new OsascriptError(
          'error',
          `osascript exited ${code}: ${trimmedErr || 'no detail'}`,
          code,
          trimmedErr,
        ),
      );
    });
  });
}
