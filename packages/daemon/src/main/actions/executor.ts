/**
 * Action executor — plan "Action Executor Hardening" / Work Unit D.
 *
 * Runs a `ResumeAction` after re-validating it against the captured
 * `ContextWindow`. Validation (URL allowlist, path cross-check, tab cap) lives
 * in `validators.ts`; this module performs the side effects.
 *
 * Work Unit E/F wire `runAction` to the `action:run` IPC handler. The
 * `openTimeline` callback is injected so this module stays decoupled from the
 * windows factory (`main/windows.ts`, owned by Work Unit E).
 */
import { shell } from 'electron';
import type { ContextWindow, ResumeAction } from '@wdiot/shared';
import { validateAction, type ValidatedAction } from './validators.js';

/** The result of attempting to execute a {@link ResumeAction}. */
export interface ActionExecutionResult {
  /** true when the action ran (or partially ran) successfully. */
  ok: boolean;
  /** how many items were acted on (tabs opened, etc.). */
  itemCount: number;
  /** Korean truncation note when the tab cap dropped items. */
  truncationNote?: string;
  /** Korean disabled tooltip when the action had nothing to run. */
  disabledTooltip?: string;
}

/** External hooks the executor needs but does not own. */
export interface ActionExecutorDeps {
  /** open the internal timeline window for a time range (Work Unit E). */
  openTimeline: (range: { from: number; to: number }) => void;
  /** open a URL in the default browser; defaults to Electron `shell`. */
  openExternal?: (url: string) => Promise<void>;
  /** open a local path in the OS default handler; defaults to Electron `shell`. */
  openPath?: (path: string) => Promise<string | void>;
}

/** True when the opaque action payload has no own keys. */
function isEmptyPayload(action: ResumeAction): boolean {
  return Object.keys(action.payload).length === 0;
}

/** Collect unique captured browser/search URLs in most-recent-first order. */
function capturedUrls(window: ContextWindow): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  for (const activity of [...window.activities].reverse()) {
    if (activity.type !== 'browser_tab' && activity.type !== 'search') continue;
    const { url } = activity.payload;
    if (seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }

  return urls;
}

/** Derive a workspace + edited files from the latest captured IDE activity. */
function capturedWorkTarget(window: ContextWindow): Record<string, unknown> {
  const files = window.activities.filter((a) => a.type === 'file_edit');
  const latest = files[files.length - 1];
  if (!latest) return {};

  const paths = [...new Set(files.map((activity) => activity.payload.filePath))];
  return {
    workspacePath: latest.payload.workspacePath,
    paths,
  };
}

/**
 * LLMs may return `{}` payloads per the v1 prompt. Fill those from the same
 * captured ContextWindow so buttons remain genuinely executable while still
 * passing through the validator's allowlist and cross-checks.
 */
function hydrateEmptyPayload(action: ResumeAction, window: ContextWindow): ResumeAction {
  if (!isEmptyPayload(action)) return action;

  switch (action.kind) {
    case 'open_tabs':
      return { ...action, payload: { urls: capturedUrls(window) } };
    case 'resume_work':
      return { ...action, payload: capturedWorkTarget(window) };
    case 'show_timeline':
      return action;
  }
}

/** Open every verified URL of an `open_tabs` action in the default browser. */
async function runOpenTabs(
  validated: ValidatedAction,
  openExternal: (url: string) => Promise<void>,
): Promise<ActionExecutionResult> {
  const urls = Array.isArray(validated.action.payload['urls'])
    ? (validated.action.payload['urls'] as string[])
    : [];

  for (const url of urls) {
    await openExternal(url);
  }

  const result: ActionExecutionResult = { ok: true, itemCount: urls.length };
  if (validated.truncationNote) result.truncationNote = validated.truncationNote;
  return result;
}

/**
 * `resume_work` re-opens the captured workspace/files in the default handler.
 * v1 keeps this minimal: open the workspace path (or the first verified file)
 * so the IDE re-focuses the project the user was on.
 */
async function runResumeWork(
  validated: ValidatedAction,
  openPath: (path: string) => Promise<string | void>,
): Promise<ActionExecutionResult> {
  const payload = validated.action.payload;
  const paths = Array.isArray(payload['paths']) ? (payload['paths'] as string[]) : [];
  const workspace =
    typeof payload['workspacePath'] === 'string' ? (payload['workspacePath'] as string) : undefined;

  const target = workspace ?? paths[0];
  if (target === undefined) {
    return { ok: false, itemCount: 0 };
  }

  const error = await openPath(target);
  if (typeof error === 'string' && error.length > 0) {
    throw new Error(error);
  }
  return { ok: true, itemCount: 1 };
}

/**
 * Validate then execute a {@link ResumeAction} against the captured
 * {@link ContextWindow}. A disabled action (nothing left after cross-check)
 * resolves with `ok: false` and the Korean tooltip — it is never executed.
 */
export async function runAction(
  action: ResumeAction,
  window: ContextWindow,
  deps: ActionExecutorDeps,
): Promise<ActionExecutionResult> {
  const openExternal = deps.openExternal ?? ((url: string) => shell.openExternal(url));
  const openPath = deps.openPath ?? ((path: string) => shell.openPath(path));
  const hydrated = hydrateEmptyPayload(action, window);
  const validated = validateAction(hydrated, window);

  if (!validated.enabled) {
    return {
      ok: false,
      itemCount: 0,
      ...(validated.disabledTooltip ? { disabledTooltip: validated.disabledTooltip } : {}),
    };
  }

  switch (validated.action.kind) {
    case 'open_tabs':
      return runOpenTabs(validated, openExternal);
    case 'resume_work':
      return runResumeWork(validated, openPath);
    case 'show_timeline':
      deps.openTimeline({
        from: window.activities[0]?.ts ?? window.assembledAt,
        to: window.assembledAt,
      });
      return { ok: true, itemCount: 1 };
    default: {
      const exhaustive: never = validated.action.kind;
      throw new Error(`unknown action kind: ${String(exhaustive)}`);
    }
  }
}
