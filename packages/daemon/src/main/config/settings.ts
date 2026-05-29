/**
 * Non-secret settings store — plan "API Key Storage" / Work Unit D.
 *
 * `electron-store` persists the small JSON settings file (context-window
 * length, LLM provider choice, model id, hotkey binding). API keys are NEVER
 * stored here — they live in the macOS Keychain via `keychain.ts`.
 */
import Store from 'electron-store';
import type { LlmProviderId } from '@wdiot/shared';

/** Default context-window length in minutes (plan B5). */
export const DEFAULT_WINDOW_MINUTES = 30;

/** Default global hotkey binding (plan Work Unit E / Boundary). */
export const DEFAULT_HOTKEY = 'Cmd+Shift+W';

/** Default LLM provider (Claude is the default — plan Guardrails). */
export const DEFAULT_PROVIDER: LlmProviderId = 'claude';

/**
 * Default model per provider (plan Open Question decision):
 * Claude -> `claude-sonnet-4-6`, OpenAI -> `gpt-4o`.
 */
export const DEFAULT_MODEL_BY_PROVIDER: Record<LlmProviderId, string> = {
  claude: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
};

/** The non-secret settings persisted to disk. */
export interface AppSettings {
  /** context-window length in minutes. */
  windowMinutes: number;
  /** which LLM provider to call. */
  provider: LlmProviderId;
  /** model id; empty string means "use the provider default". */
  model: string;
  /** global hotkey accelerator string. */
  hotkey: string;
}

/** Default settings used on first run / when a key is missing. */
export const DEFAULT_SETTINGS: AppSettings = {
  windowMinutes: DEFAULT_WINDOW_MINUTES,
  provider: DEFAULT_PROVIDER,
  model: '',
  hotkey: DEFAULT_HOTKEY,
};

let store: Store<AppSettings> | undefined;

/** Lazily create the singleton `electron-store` instance. */
function getStore(): Store<AppSettings> {
  store ??= new Store<AppSettings>({
    name: 'settings',
    defaults: DEFAULT_SETTINGS,
  });
  return store;
}

/** Read the full settings object (defaults merged in). */
export function getSettings(): AppSettings {
  const s = getStore();
  return {
    windowMinutes: s.get('windowMinutes', DEFAULT_WINDOW_MINUTES),
    provider: s.get('provider', DEFAULT_PROVIDER),
    model: s.get('model', ''),
    hotkey: s.get('hotkey', DEFAULT_HOTKEY),
  };
}

/** Persist a partial settings update. */
export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const s = getStore();
  for (const [key, value] of Object.entries(patch) as [
    keyof AppSettings,
    AppSettings[keyof AppSettings],
  ][]) {
    if (value !== undefined) s.set(key, value);
  }
  return getSettings();
}

/**
 * Resolve the effective model id for the configured provider — the explicit
 * `model` setting when set, otherwise the provider default.
 */
export function resolveModel(settings: AppSettings = getSettings()): string {
  return settings.model.trim().length > 0
    ? settings.model.trim()
    : DEFAULT_MODEL_BY_PROVIDER[settings.provider];
}

/** Reset the in-memory store handle (test isolation only). */
export function __resetSettingsStoreForTests(): void {
  store = undefined;
}
