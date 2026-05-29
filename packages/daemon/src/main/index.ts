/**
 * WDIOT daemon — Electron main process bootstrap.
 *
 * Work Unit F wires the previously independent modules into one daemon
 * lifecycle: DB, capture, ingest, hotkey, windows, IPC, and tray status.
 */
import { app } from 'electron';
import { createTray, destroyTray, refreshTray } from './tray.js';
import { openDatabase, type Db } from './storage/db.js';
import { CaptureScheduler } from './capture/index.js';
import { startIngestServer, type IngestServer } from './ingest/server.js';
import { registerHotkey, unregisterHotkey } from './hotkey.js';
import {
  destroyAllWindows,
  getPaletteWindow,
  openPaletteWindow,
  openTimelineWindow,
} from './windows.js';
import { registerIpcHandlers, unregisterIpcHandlers } from './ipc.js';
import { createRuntimeBackend } from './runtime-backend.js';
import { getSettings } from './config/settings.js';

let db: Db | undefined;
let capture: CaptureScheduler | undefined;
let ingest: IngestServer | undefined;

/**
 * Acquire the single-instance lock. A second launch quits immediately so only
 * one menu-bar daemon ever runs.
 */
function ensureSingleInstance(): boolean {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return false;
  }
  return true;
}

function bootstrap(): void {
  if (!ensureSingleInstance()) return;

  // Menu-bar daemon: no Dock icon, no main window.
  app.dock?.hide();

  app.on('second-instance', () => {
    // Another launch attempt — the running instance simply stays alive.
  });

  app.whenReady().then(() => {
    db = openDatabase();

    capture = new CaptureScheduler(db);
    capture.health.onChange(() => refreshTray());
    capture.start();

    registerIpcHandlers(
      createRuntimeBackend({
        db,
        openTimeline: () => {
          openTimelineWindow();
        },
      }),
      getPaletteWindow,
    );

    createTray({
      openTimeline: () => openTimelineWindow(),
      health: capture.health,
    });

    registerHotkey(() => {
      openPaletteWindow();
    }, getSettings().hotkey);
    refreshTray();

    void startIngestServer({
      db,
      healthProvider: () =>
        Object.fromEntries(capture?.health.all().map((h) => [h.source, h.state]) ?? []),
    })
      .then((server) => {
        ingest = server;
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[wdiot] ingest server failed to start:', message);
      });
  });

  // Tray-only app: do NOT quit when (non-existent) windows close.
  app.on('window-all-closed', () => {
    // Intentionally empty — the daemon lives in the menu bar.
  });

  app.on('before-quit', () => {
    unregisterHotkey();
    unregisterIpcHandlers();
    capture?.stop();
    void ingest?.stop();
    destroyAllWindows();
    destroyTray();
    db?.close();
  });
}

bootstrap();
