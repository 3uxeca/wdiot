/**
 * contextBridge preload for the palette renderer.
 *
 * Exposes a typed, minimal API surface on `window.wdiot`. The renderer never
 * touches `ipcRenderer` directly — every channel is wrapped here so the IPC
 * contract is a single, auditable seam (plan Boundary 1, security-clean).
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  IPC,
  type ActionRunResult,
  type PaletteApi,
  type PaletteIntentPush,
  type PaletteInvokeResult,
  type Unsubscribe,
} from '../ipc/contract.js';

const api: PaletteApi = {
  appName: 'WDIOT',
  invoke(): Promise<PaletteInvokeResult> {
    return ipcRenderer.invoke(IPC.PALETTE_INVOKE);
  },
  onIntent(callback): Unsubscribe {
    const listener = (_event: IpcRendererEvent, push: PaletteIntentPush): void => {
      callback(push);
    };
    ipcRenderer.on(IPC.PALETTE_INTENT, listener);
    return () => ipcRenderer.removeListener(IPC.PALETTE_INTENT, listener);
  },
  runAction(action): Promise<ActionRunResult> {
    return ipcRenderer.invoke(IPC.ACTION_RUN, action);
  },
};

contextBridge.exposeInMainWorld('wdiot', api);
