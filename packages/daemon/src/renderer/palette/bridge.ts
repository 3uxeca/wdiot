/**
 * Typed accessor for the palette renderer's `window.wdiot` bridge.
 *
 * The runtime object is installed by `preload/palette-preload.ts` via
 * `contextBridge`. A local accessor (rather than a global `Window`
 * augmentation) avoids a `Window.wdiot` type collision with the timeline
 * renderer, which compiles under the same TS program.
 */
import type { PaletteApi } from '../../ipc/contract.js';

/** The palette IPC bridge exposed on `window.wdiot`. */
export function paletteBridge(): PaletteApi {
  return (window as unknown as { wdiot: PaletteApi }).wdiot;
}
