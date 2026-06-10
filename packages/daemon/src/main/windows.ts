/**
 * BrowserWindow factory for the palette and timeline renderers.
 *
 * Both windows are created lazily and destroyed on close so the always-on
 * daemon keeps a minimal memory footprint (plan Risks — Electron footprint).
 * Every window is security-hardened: `nodeIntegration: false`,
 * `contextIsolation: true`, `sandbox: true` (plan Boundary 1).
 *
 * NOTE on preload paths: Electron loads preload scripts as CommonJS, so
 * electron-vite emits them as `.cjs` into `out/preload/`. The main
 * bundle lives in `out/main/`, so the preload is resolved relative to this
 * file's runtime directory as `../preload/<name>.cjs`.
 */
import { BrowserWindow, screen } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/** Absolute path to the directory holding the running main bundle. */
const mainDir = dirname(fileURLToPath(import.meta.url));

/** Resolve a preload script emitted by electron-vite (`.cjs` output). */
function preloadPath(name: 'palette-preload' | 'timeline-preload'): string {
  return join(mainDir, '..', 'preload', `${name}.cjs`);
}

/**
 * Resolve a renderer HTML entry. In dev, electron-vite injects
 * `ELECTRON_RENDERER_URL`; in production the HTML is bundled under
 * `out/renderer/<name>/index.html`.
 */
function rendererEntry(name: 'palette' | 'timeline'): {
  url?: string;
  file?: string;
} {
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    return { url: `${devUrl}/${name}/index.html` };
  }
  return { file: join(mainDir, '..', 'renderer', name, 'index.html') };
}

/** Load the resolved renderer entry into a window. */
function loadRenderer(
  window: BrowserWindow,
  name: 'palette' | 'timeline',
): void {
  const entry = rendererEntry(name);
  attachRendererDiagnostics(window, name, entry.url ?? entry.file ?? 'unknown');
  if (entry.url) {
    void window.loadURL(entry.url);
  } else if (entry.file) {
    void window.loadFile(entry.file);
  }
}

/** Mirror renderer failures into the dev terminal instead of showing a blank window. */
function attachRendererDiagnostics(
  window: BrowserWindow,
  name: 'palette' | 'timeline',
  entry: string,
): void {
  window.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL) => {
      console.error(
        `[wdiot] ${name} renderer failed to load ${validatedURL || entry}: ${errorCode} ${errorDescription}`,
      );
    },
  );

  window.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[wdiot] ${name} renderer process gone:`, details);
  });

  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level < 2) return;
    console.error(`[wdiot] ${name} renderer: ${message} (${sourceId}:${line})`);
  });
}

// --- palette window --------------------------------------------------------

let paletteWindow: BrowserWindow | null = null;

/** Palette window geometry — a small, frameless, centered card. */
const PALETTE_WIDTH = 560;
const PALETTE_HEIGHT = 360;

/**
 * Create (or focus) the palette window. Frameless, centered, always-on-top so
 * it behaves like a command palette. Destroyed on close — re-created on the
 * next hotkey press.
 */
export function openPaletteWindow(): BrowserWindow {
  if (paletteWindow && !paletteWindow.isDestroyed()) {
    paletteWindow.show();
    paletteWindow.focus();
    return paletteWindow;
  }

  const { width: screenW, height: screenH } =
    screen.getPrimaryDisplay().workAreaSize;

  paletteWindow = new BrowserWindow({
    width: PALETTE_WIDTH,
    height: PALETTE_HEIGHT,
    x: Math.round((screenW - PALETTE_WIDTH) / 2),
    y: Math.round((screenH - PALETTE_HEIGHT) / 3),
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    transparent: true,
    vibrancy: 'under-window',
    webPreferences: {
      preload: preloadPath('palette-preload'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  loadRenderer(paletteWindow, 'palette');

  // Wait for the HTML to finish loading so renderer failures do not look like
  // an empty palette.
  paletteWindow.webContents.once('did-finish-load', () => {
    paletteWindow?.show();
    paletteWindow?.focus();
  });

  // A command palette dismisses when it loses focus.
  paletteWindow.on('blur', () => {
    paletteWindow?.close();
  });

  paletteWindow.on('closed', () => {
    paletteWindow = null;
  });

  return paletteWindow;
}

/** Close the palette window if open. */
export function closePaletteWindow(): void {
  if (paletteWindow && !paletteWindow.isDestroyed()) {
    paletteWindow.close();
  }
  paletteWindow = null;
}

/** The live palette window, or `null` when closed (used by the IPC layer). */
export function getPaletteWindow(): BrowserWindow | null {
  return paletteWindow && !paletteWindow.isDestroyed() ? paletteWindow : null;
}

// --- timeline window -------------------------------------------------------

let timelineWindow: BrowserWindow | null = null;

/** Timeline window geometry — a standard resizable viewer. */
const TIMELINE_WIDTH = 720;
const TIMELINE_HEIGHT = 640;

/**
 * Create (or focus) the timeline window. A normal, framed, resizable window.
 * Destroyed on close.
 */
export function openTimelineWindow(): BrowserWindow {
  if (timelineWindow && !timelineWindow.isDestroyed()) {
    timelineWindow.show();
    timelineWindow.focus();
    return timelineWindow;
  }

  timelineWindow = new BrowserWindow({
    width: TIMELINE_WIDTH,
    height: TIMELINE_HEIGHT,
    minWidth: 480,
    minHeight: 360,
    title: 'WDIOT — 타임라인',
    show: false,
    backgroundColor: '#0b0e14',
    webPreferences: {
      preload: preloadPath('timeline-preload'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  loadRenderer(timelineWindow, 'timeline');

  timelineWindow.webContents.once('did-finish-load', () => {
    timelineWindow?.show();
    timelineWindow?.focus();
  });

  timelineWindow.on('closed', () => {
    timelineWindow = null;
  });

  return timelineWindow;
}

/** Close the timeline window if open. */
export function closeTimelineWindow(): void {
  if (timelineWindow && !timelineWindow.isDestroyed()) {
    timelineWindow.close();
  }
  timelineWindow = null;
}

/** The live timeline window, or `null` when closed. */
export function getTimelineWindow(): BrowserWindow | null {
  return timelineWindow && !timelineWindow.isDestroyed() ? timelineWindow : null;
}

/** Destroy both windows — called on app quit. */
export function destroyAllWindows(): void {
  closePaletteWindow();
  closeTimelineWindow();
}
