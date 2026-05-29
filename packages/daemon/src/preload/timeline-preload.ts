/**
 * contextBridge preload for the timeline renderer.
 *
 * Exposes a typed, minimal API surface on `window.wdiot`. The renderer never
 * touches `ipcRenderer` directly — `timeline:query` is wrapped here.
 */
import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC,
  type TimelineApi,
  type TimelineQueryResult,
} from '../ipc/contract.js';

const api: TimelineApi = {
  appName: 'WDIOT',
  query(request): Promise<TimelineQueryResult> {
    return ipcRenderer.invoke(IPC.TIMELINE_QUERY, request ?? {});
  },
};

contextBridge.exposeInMainWorld('wdiot', api);
