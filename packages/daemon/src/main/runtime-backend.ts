/**
 * Work Unit F backend wiring for the IPC layer.
 *
 * This is the concrete bridge from renderer IPC calls to the storage,
 * context, LLM, and action modules implemented in earlier work units.
 */
import type { ContextDigest, ContextWindow, IntentResult, ResumeAction } from '@wdiot/shared';
import { assembleContextWindow } from './context/assembler.js';
import { compressContextWindow } from './context/compressor.js';
import { getSettings, resolveModel } from './config/settings.js';
import { getApiKey } from './config/keychain.js';
import { createLlmProvider } from './llm/provider.js';
import { runAction as executeAction } from './actions/executor.js';
import { sliceRecentActivities, HARD_EVENT_CAP } from './storage/activity-repo.js';
import type { Db } from './storage/db.js';
import type {
  ActionRunResult,
  IpcBackend,
  TimelineQueryRequest,
  TimelineQueryResult,
} from './ipc.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RuntimeBackendDeps {
  db: Db;
  openTimeline: (range: { from: number; to: number }) => void;
}

/**
 * Build the real IPC backend. It retains the last raw ContextWindow so action
 * validation runs against the same captured window that produced the digest.
 */
export function createRuntimeBackend(deps: RuntimeBackendDeps): IpcBackend {
  let lastWindow: ContextWindow | undefined;

  function assembleWindow(): ContextWindow {
    const settings = getSettings();
    return assembleContextWindow(deps.db, {
      rangeMinutes: settings.windowMinutes,
      limit: HARD_EVENT_CAP,
    });
  }

  return {
    async assembleDigest(): Promise<ContextDigest> {
      const window = assembleWindow();
      lastWindow = window;
      return compressContextWindow(window);
    },

    async reconstructIntent(digest: ContextDigest, signal: AbortSignal): Promise<IntentResult> {
      const settings = getSettings();
      const apiKey = await getApiKey();
      if (!apiKey) {
        throw new Error('LLM API 키가 설정되어 있지 않습니다.');
      }

      const provider = createLlmProvider({
        provider: settings.provider,
        apiKey,
        model: resolveModel(settings),
      });

      return provider.reconstructIntent({ digest, signal });
    },

    async runAction(action: ResumeAction): Promise<ActionRunResult> {
      const window = lastWindow ?? assembleWindow();
      const result = await executeAction(action, window, {
        openTimeline: deps.openTimeline,
      });

      if (result.ok) return { ok: true };
      return {
        ok: false,
        message: result.disabledTooltip ?? '액션을 실행하지 못했습니다.',
      };
    },

    async queryTimeline(request: TimelineQueryRequest = {}): Promise<TimelineQueryResult> {
      const sinceTs = request.sinceTs ?? Date.now() - DAY_MS;
      return {
        activities: sliceRecentActivities(deps.db, sinceTs, HARD_EVENT_CAP),
      };
    },
  };
}
