/**
 * Typed accessor for the timeline renderer's `window.wdiot` bridge.
 *
 * The runtime object is installed by `preload/timeline-preload.ts` via
 * `contextBridge`. A local accessor (rather than a global `Window`
 * augmentation) avoids a `Window.wdiot` type collision with the palette
 * renderer, which compiles under the same TS program.
 */
import type { TimelineApi } from '../../ipc/contract.js';

/** The timeline IPC bridge exposed on `window.wdiot`. */
export function timelineBridge(): TimelineApi {
  return (window as unknown as { wdiot: TimelineApi }).wdiot;
}
