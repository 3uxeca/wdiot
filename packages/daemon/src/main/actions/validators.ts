/**
 * Action validators — plan "Action Executor Hardening" (change #3).
 *
 * Every LLM-suggested `ResumeAction` is hardened before it is shown or run:
 *  (a) URL scheme allowlist — `open_tabs` URLs must be `http`/`https`.
 *  (b) Cross-check — every URL/path must appear in the captured `ContextWindow`;
 *      items not present are dropped. If all are dropped the action is disabled.
 *  (c) Tab cap — `open_tabs` is capped at 10 URLs; truncation is surfaced.
 *  (d) `show_timeline` is always safe (no payload validation needed).
 */
import type { ContextWindow, ResumeAction } from '@wdiot/shared';

/** Hard cap on tabs an `open_tabs` action may open (plan change #3). */
export const MAX_OPEN_TABS = 10;

/** URL schemes permitted for `open_tabs` (plan change #3). */
export const ALLOWED_URL_SCHEMES = ['http:', 'https:'] as const;

/** Korean tooltip shown when a validated action has nothing left to run. */
export const EMPTY_ACTION_TOOLTIP = '실행할 수 있는 항목이 없습니다';

/** The outcome of validating one {@link ResumeAction}. */
export interface ValidatedAction {
  /** the action with its payload narrowed to verified items. */
  action: ResumeAction;
  /** false when every payload item was dropped — palette disables the button. */
  enabled: boolean;
  /** Korean tooltip explaining why the action is disabled (when `!enabled`). */
  disabledTooltip?: string;
  /** present when items were dropped by the tab cap — Korean "(10개 중 N개)". */
  truncationNote?: string;
}

/** True when `url` has an allowlisted (`http`/`https`) scheme. */
function hasAllowedScheme(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return (ALLOWED_URL_SCHEMES as readonly string[]).includes(protocol);
  } catch {
    return false;
  }
}

/** Collect every URL captured in the window (browser tabs + searches). */
function windowUrls(window: ContextWindow): Set<string> {
  const urls = new Set<string>();
  for (const activity of window.activities) {
    if (activity.type === 'browser_tab' || activity.type === 'search') {
      urls.add(activity.payload.url);
    }
  }
  return urls;
}

/** Collect every file path + workspace path captured in the window. */
function windowPaths(window: ContextWindow): Set<string> {
  const paths = new Set<string>();
  for (const activity of window.activities) {
    if (activity.type !== 'file_edit') continue;
    paths.add(activity.payload.filePath);
    paths.add(activity.payload.workspacePath);
    for (const recent of activity.payload.recentFiles ?? []) {
      paths.add(recent);
    }
  }
  return paths;
}

/** Read a string[] field off an opaque payload, ignoring non-string entries. */
function readStringArray(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key];
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

/**
 * Validate an `open_tabs` action: allowlist schemes, cross-check URLs against
 * the captured window, then cap at {@link MAX_OPEN_TABS}.
 */
function validateOpenTabs(
  action: ResumeAction,
  window: ContextWindow,
): ValidatedAction {
  const captured = windowUrls(window);
  const requested = readStringArray(action.payload, 'urls');

  const verified = requested.filter(
    (url) => hasAllowedScheme(url) && captured.has(url),
  );

  if (verified.length === 0) {
    return {
      action: { ...action, payload: { urls: [] } },
      enabled: false,
      disabledTooltip: EMPTY_ACTION_TOOLTIP,
    };
  }

  const capped = verified.slice(0, MAX_OPEN_TABS);
  const result: ValidatedAction = {
    action: { ...action, payload: { urls: capped } },
    enabled: true,
  };
  if (verified.length > MAX_OPEN_TABS) {
    result.truncationNote = `(${verified.length}개 중 ${capped.length}개)`;
  }
  return result;
}

/**
 * Validate a `resume_work` action: cross-check every file/workspace path in the
 * payload against the captured window; drop paths that were not captured.
 */
function validateResumeWork(
  action: ResumeAction,
  window: ContextWindow,
): ValidatedAction {
  const captured = windowPaths(window);
  const requestedPaths = readStringArray(action.payload, 'paths');
  const verifiedPaths = requestedPaths.filter((p) => captured.has(p));

  const workspaceRaw = action.payload['workspacePath'];
  const workspace =
    typeof workspaceRaw === 'string' && captured.has(workspaceRaw)
      ? workspaceRaw
      : undefined;

  if (verifiedPaths.length === 0 && workspace === undefined) {
    return {
      action: { ...action, payload: {} },
      enabled: false,
      disabledTooltip: EMPTY_ACTION_TOOLTIP,
    };
  }

  const payload: Record<string, unknown> = { paths: verifiedPaths };
  if (workspace !== undefined) payload['workspacePath'] = workspace;
  return { action: { ...action, payload }, enabled: true };
}

/**
 * Validate + harden one {@link ResumeAction} against the captured
 * {@link ContextWindow}. `show_timeline` always passes; the other kinds are
 * cross-checked and dropped/truncated as needed.
 */
export function validateAction(
  action: ResumeAction,
  window: ContextWindow,
): ValidatedAction {
  switch (action.kind) {
    case 'open_tabs':
      return validateOpenTabs(action, window);
    case 'resume_work':
      return validateResumeWork(action, window);
    case 'show_timeline':
      return { action, enabled: true };
    default: {
      const exhaustive: never = action.kind;
      throw new Error(`unknown action kind: ${String(exhaustive)}`);
    }
  }
}

/** Validate every action in a list against the captured window. */
export function validateActions(
  actions: readonly ResumeAction[],
  window: ContextWindow,
): ValidatedAction[] {
  return actions.map((action) => validateAction(action, window));
}
