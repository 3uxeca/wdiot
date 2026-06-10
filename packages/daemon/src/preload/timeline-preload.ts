/**
 * contextBridge preload for the timeline renderer.
 *
 * Exposes a typed, minimal API surface on `window.wdiot`. The renderer never
 * touches `ipcRenderer` directly — `timeline:query` is wrapped here.
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { TimelineApi, TimelineQueryResult } from '../ipc/contract.js';

// Keep preload self-contained: sandboxed preload cannot require local chunks.
const TIMELINE_QUERY = 'timeline:query';

const api: TimelineApi = {
  appName: 'WDIOT',
  query(request): Promise<TimelineQueryResult> {
    return ipcRenderer.invoke(TIMELINE_QUERY, request ?? {});
  },
};

contextBridge.exposeInMainWorld('wdiot', api);
