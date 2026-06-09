/**
 * Menu-bar tray icon + menu.
 *
 * Korean menu-bar surface for runtime status and common actions.
 */
import { Tray, Menu, nativeImage, shell } from 'electron';
import { app } from 'electron';
import { trayIconPng } from './tray-icon.js';
import {
  type HealthRegistry,
  permissionKindForSource,
  settingsLinkForSource,
  trayStatusStrings,
} from './capture/index.js';
import { getHotkeyState } from './hotkey.js';

let tray: Tray | null = null;

export interface TrayOptions {
  openTimeline?: () => void;
  health?: HealthRegistry;
}

let options: TrayOptions = {};

/** Build the placeholder template icon as a `nativeImage`. */
function buildTrayIcon(): Electron.NativeImage {
  const image = nativeImage.createFromBuffer(trayIconPng);
  // Template image renders correctly in light/dark menu bars.
  image.setTemplateImage(true);
  return image;
}

function settingsUrl(kind: ReturnType<typeof permissionKindForSource>): string {
  switch (kind) {
    case 'accessibility':
      return 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility';
    case 'automation':
      return 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation';
  }
}

function healthMenuItems(): Electron.MenuItemConstructorOptions[] {
  const health = options.health;
  if (!health) return [{ label: '수집 상태: 준비됨', enabled: false }];

  const statusItems: Electron.MenuItemConstructorOptions[] = trayStatusStrings(health).map(
    (label) => ({
      label,
      enabled: false,
    }),
  );

  const deniedLinks: Electron.MenuItemConstructorOptions[] = [];
  for (const snapshot of health.all()) {
    const label = settingsLinkForSource(snapshot);
    if (!label) continue;
    deniedLinks.push({
      label,
      click: () => {
        void shell.openExternal(settingsUrl(permissionKindForSource(snapshot.source)));
      },
    });
  }

  return deniedLinks.length > 0
    ? [...statusItems, { type: 'separator' }, ...deniedLinks]
    : statusItems;
}

/** Build the Korean tray context menu. */
function buildMenu(): Electron.Menu {
  const hotkey = getHotkeyState();
  return Menu.buildFromTemplate([
    { label: 'WDIOT — 왜켰더라', enabled: false },
    { type: 'separator' },
    {
      label: '타임라인 보기',
      enabled: Boolean(options.openTimeline),
      click: () => options.openTimeline?.(),
    },
    ...(hotkey.conflictMessage ? [{ label: hotkey.conflictMessage, enabled: false }] : []),
    ...healthMenuItems(),
    { label: '설정', enabled: false },
    { type: 'separator' },
    {
      label: '종료',
      click: () => {
        app.quit();
      },
    },
  ]);
}

/** Create the menu-bar tray. Safe to call once after `app.whenReady()`. */
export function createTray(nextOptions: TrayOptions = {}): Tray {
  options = { ...options, ...nextOptions };
  if (tray) {
    refreshTray();
    return tray;
  }

  tray = new Tray(buildTrayIcon());
  tray.setTitle('W');
  tray.setToolTip('WDIOT — 왜켰더라');
  tray.setContextMenu(buildMenu());
  return tray;
}

/** Rebuild the tray menu after state changes. */
export function refreshTray(nextOptions: TrayOptions = {}): void {
  options = { ...options, ...nextOptions };
  tray?.setContextMenu(buildMenu());
}

/** Destroy the tray (called on quit). */
export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
