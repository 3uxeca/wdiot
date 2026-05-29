/**
 * Placeholder menu-bar tray icon — a 16x16 RGBA PNG embedded as base64 so it
 * survives bundling without an asset pipeline. Replace with a designed icon in
 * a later iteration.
 */
const TRAY_ICON_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAARUlEQVR4nGNgoBH4jwNTpJkoQ/ApJGgILgX/iVBD0GaCavE5DZ936GcAurNJMgCfoVhtIVYzSTFBtBqKEhI2hVTPD9QHAPTkV6mNoLJjAAAAAElFTkSuQmCC';

/** The tray icon as a PNG byte buffer. */
export const trayIconPng: Buffer = Buffer.from(TRAY_ICON_BASE64, 'base64');
