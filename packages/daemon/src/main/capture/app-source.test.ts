import { describe, it, expect } from 'vitest';
import {
  AppSwitchDetector,
  toAppSwitchActivity,
  type ActiveApp,
} from './app-source.js';

describe('toAppSwitchActivity', () => {
  it('builds a well-formed app_switch Activity', () => {
    const app: ActiveApp = {
      appName: 'Cursor',
      bundleId: 'com.todesktop.cursor',
      windowTitle: 'scheduler.ts',
    };
    const activity = toAppSwitchActivity(app, 1_700_000_000_000);
    expect(activity.type).toBe('app_switch');
    expect(activity.source).toBe('app');
    expect(activity.ts).toBe(1_700_000_000_000);
    expect(activity.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(activity.payload).toEqual({
      appName: 'Cursor',
      bundleId: 'com.todesktop.cursor',
      windowTitle: 'scheduler.ts',
    });
  });

  it('omits optional payload fields when absent', () => {
    const activity = toAppSwitchActivity({ appName: 'Finder' });
    expect(activity.payload).toEqual({ appName: 'Finder' });
  });
});

describe('AppSwitchDetector — edge-triggered', () => {
  it('emits an Activity on the first observation', () => {
    const d = new AppSwitchDetector();
    const result = d.observe({ appName: 'Safari', bundleId: 'com.apple.Safari' });
    expect(result?.type).toBe('app_switch');
    expect(result?.payload.appName).toBe('Safari');
  });

  it('emits nothing when the same app is observed again (no app change)', () => {
    const d = new AppSwitchDetector();
    d.observe({ appName: 'Safari', bundleId: 'com.apple.Safari' });
    const second = d.observe({ appName: 'Safari', bundleId: 'com.apple.Safari' });
    expect(second).toBeUndefined();
  });

  it('emits again when the active app changes', () => {
    const d = new AppSwitchDetector();
    d.observe({ appName: 'Safari', bundleId: 'com.apple.Safari' });
    const switched = d.observe({ appName: 'Cursor', bundleId: 'com.todesktop.cursor' });
    expect(switched?.payload.appName).toBe('Cursor');
  });

  it('does not re-emit on a window-title change within the same app', () => {
    const d = new AppSwitchDetector();
    d.observe({ appName: 'Cursor', bundleId: 'com.todesktop.cursor', windowTitle: 'a.ts' });
    const sameApp = d.observe({
      appName: 'Cursor',
      bundleId: 'com.todesktop.cursor',
      windowTitle: 'b.ts',
    });
    expect(sameApp).toBeUndefined();
  });

  it('falls back to appName for identity when bundleId is absent', () => {
    const d = new AppSwitchDetector();
    expect(d.observe({ appName: 'CustomApp' })).toBeDefined();
    expect(d.observe({ appName: 'CustomApp' })).toBeUndefined();
    expect(d.observe({ appName: 'OtherApp' })).toBeDefined();
  });

  it('re-emits after reset()', () => {
    const d = new AppSwitchDetector();
    d.observe({ appName: 'Safari' });
    d.reset();
    expect(d.observe({ appName: 'Safari' })).toBeDefined();
  });
});
