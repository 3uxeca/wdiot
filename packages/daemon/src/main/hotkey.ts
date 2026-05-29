/**
 * Global hotkey registration — `Cmd+Shift+W` opens the palette.
 *
 * `globalShortcut.register` returns `false` when the accelerator is already
 * claimed by another app (or the OS). v1 must NOT fail silently in that case:
 * the conflict is recorded as state the tray can read and surface to the user
 * in Korean (plan Work Unit E acceptance + Risks table).
 *
 * The default accelerator is hardcoded here. Work Unit D owns the settings
 * module; Work Unit F can later re-register with a user-configured binding by
 * passing an `accelerator` to {@link registerHotkey}.
 */
import { globalShortcut } from 'electron';

/** Default hotkey accelerator (Electron accelerator syntax). */
export const DEFAULT_HOTKEY = 'CommandOrControl+Shift+W';

/** Human-readable form used in the Korean conflict message. */
const HOTKEY_DISPLAY = 'Cmd+Shift+W';

/** Korean message the tray shows when the accelerator is already in use. */
export const HOTKEY_CONFLICT_MESSAGE = `단축키 충돌: ${HOTKEY_DISPLAY}가 다른 앱에서 사용 중입니다`;

/** Outcome of a hotkey registration attempt. */
export interface HotkeyState {
  /** the accelerator the daemon attempted to register */
  accelerator: string;
  /** true when `globalShortcut.register` succeeded */
  registered: boolean;
  /**
   * true when registration failed because the accelerator is already claimed.
   * The tray reads this to show {@link HOTKEY_CONFLICT_MESSAGE}.
   */
  conflict: boolean;
  /** Korean, tray-facing message when `conflict` is true; `null` otherwise. */
  conflictMessage: string | null;
}

/** Latest registration result, readable by the tray without re-registering. */
let currentState: HotkeyState = {
  accelerator: DEFAULT_HOTKEY,
  registered: false,
  conflict: false,
  conflictMessage: null,
};

/**
 * Register the global hotkey. Must be called after `app.whenReady()`.
 *
 * `onTrigger` runs when the hotkey fires (Work Unit F passes the palette
 * open/toggle callback). The return value is checked: a `false` from
 * `globalShortcut.register` is surfaced as a conflict in {@link HotkeyState}
 * instead of being swallowed.
 *
 * @returns the resulting {@link HotkeyState}.
 */
export function registerHotkey(
  onTrigger: () => void,
  accelerator: string = DEFAULT_HOTKEY,
): HotkeyState {
  // Drop any prior binding so re-registration (e.g. settings change) is clean.
  if (globalShortcut.isRegistered(currentState.accelerator)) {
    globalShortcut.unregister(currentState.accelerator);
  }

  let registered = false;
  try {
    registered = globalShortcut.register(accelerator, onTrigger);
  } catch {
    // `register` can throw on a malformed accelerator — treat as a failure.
    registered = false;
  }

  // Defensive double-check: on some platforms `register` returns true but the
  // binding is not actually held. `isRegistered` is the source of truth.
  if (registered && !globalShortcut.isRegistered(accelerator)) {
    registered = false;
  }

  currentState = {
    accelerator,
    registered,
    conflict: !registered,
    conflictMessage: registered ? null : HOTKEY_CONFLICT_MESSAGE,
  };
  return currentState;
}

/** Read the latest hotkey state without re-registering (used by the tray). */
export function getHotkeyState(): HotkeyState {
  return currentState;
}

/** Unregister the hotkey. Safe to call on quit even if registration failed. */
export function unregisterHotkey(): void {
  if (globalShortcut.isRegistered(currentState.accelerator)) {
    globalShortcut.unregister(currentState.accelerator);
  }
  currentState = {
    ...currentState,
    registered: false,
  };
}
