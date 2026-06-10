/**
 * contextBridge preload for the palette renderer.
 *
 * Exposes a typed, minimal API surface on `window.wdiot`. The renderer never
 * touches `ipcRenderer` directly — every channel is wrapped here so the IPC
 * contract is a single, auditable seam (plan Boundary 1, security-clean).
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type {
  ActionRunResult,
  PaletteApi,
  PaletteIntentPush,
  PaletteInvokeResult,
  Unsubscribe,
} from '../ipc/contract.js';

// Keep preload self-contained: sandboxed preload cannot require local chunks.
const PALETTE_INVOKE = 'palette:invoke';
const PALETTE_INTENT = 'palette:intent';
const ACTION_RUN = 'action:run';

const api: PaletteApi = {
  appName: 'WDIOT',
  invoke(): Promise<PaletteInvokeResult> {
    return ipcRenderer.invoke(PALETTE_INVOKE);
  },
  onIntent(callback): Unsubscribe {
    const listener = (_event: IpcRendererEvent, push: PaletteIntentPush): void => {
      callback(push);
    };
    ipcRenderer.on(PALETTE_INTENT, listener);
    return () => ipcRenderer.removeListener(PALETTE_INTENT, listener);
  },
  runAction(action): Promise<ActionRunResult> {
    return ipcRenderer.invoke(ACTION_RUN, action);
  },
};

contextBridge.exposeInMainWorld('wdiot', api);
