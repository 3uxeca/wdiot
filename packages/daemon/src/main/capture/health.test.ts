import { describe, it, expect } from 'vitest';
import {
  SourceHealthMachine,
  HealthRegistry,
  DENIED_ESCALATION_THRESHOLD,
  trayStatusString,
  trayStatusStrings,
  settingsLinkForSource,
  permissionKindForSource,
  type HealthChangeEvent,
} from './health.js';

describe('SourceHealthMachine — state transitions', () => {
  it('starts in ok', () => {
    const m = new SourceHealthMachine('chrome');
    expect(m.snapshot().state).toBe('ok');
    expect(m.snapshot().consecutiveFailures).toBe(0);
  });

  it('ok -> degraded on a single transient failure', () => {
    const m = new SourceHealthMachine('chrome');
    const changed = m.report({ kind: 'transient' });
    expect(changed).toBe(true);
    expect(m.snapshot().state).toBe('degraded');
    expect(m.snapshot().consecutiveFailures).toBe(1);
  });

  it('degraded -> ok on success (transient recovery)', () => {
    const m = new SourceHealthMachine('chrome');
    m.report({ kind: 'transient' });
    const changed = m.report({ kind: 'success' }, 1000);
    expect(changed).toBe(true);
    expect(m.snapshot().state).toBe('ok');
    expect(m.snapshot().consecutiveFailures).toBe(0);
    expect(m.snapshot().lastOkTs).toBe(1000);
  });

  it('escalates degraded -> denied after N consecutive transient failures', () => {
    const m = new SourceHealthMachine('safari');
    for (let i = 0; i < DENIED_ESCALATION_THRESHOLD - 1; i += 1) {
      m.report({ kind: 'transient' });
      expect(m.snapshot().state).toBe('degraded');
    }
    const changed = m.report({ kind: 'transient' });
    expect(changed).toBe(true);
    expect(m.snapshot().state).toBe('denied');
  });

  it('ok -> denied immediately on a permission-denied outcome (mid-session revocation)', () => {
    const m = new SourceHealthMachine('chrome');
    const changed = m.report({ kind: 'denied' });
    expect(changed).toBe(true);
    expect(m.snapshot().state).toBe('denied');
  });

  it('denied -> ok on the next success (re-grant)', () => {
    const m = new SourceHealthMachine('chrome');
    m.report({ kind: 'denied' });
    expect(m.snapshot().state).toBe('denied');
    const changed = m.report({ kind: 'success' });
    expect(changed).toBe(true);
    expect(m.snapshot().state).toBe('ok');
  });

  it('a transient blip while denied does not downgrade to degraded', () => {
    const m = new SourceHealthMachine('chrome');
    m.report({ kind: 'denied' });
    const changed = m.report({ kind: 'transient' });
    expect(changed).toBe(false);
    expect(m.snapshot().state).toBe('denied');
  });

  it('full cycle ok -> degraded -> denied -> ok', () => {
    const m = new SourceHealthMachine('safari');
    expect(m.snapshot().state).toBe('ok');
    m.report({ kind: 'transient' });
    expect(m.snapshot().state).toBe('degraded');
    for (let i = 1; i < DENIED_ESCALATION_THRESHOLD; i += 1) {
      m.report({ kind: 'transient' });
    }
    expect(m.snapshot().state).toBe('denied');
    m.report({ kind: 'success' });
    expect(m.snapshot().state).toBe('ok');
  });

  it('reports no state change when a transient failure only increments the count', () => {
    const m = new SourceHealthMachine('app');
    m.report({ kind: 'transient' }); // ok -> degraded (changed)
    const changed = m.report({ kind: 'transient' }); // degraded -> degraded
    expect(changed).toBe(false);
    expect(m.snapshot().consecutiveFailures).toBe(2);
  });
});

describe('HealthRegistry', () => {
  it('tracks all three sources independently', () => {
    const reg = new HealthRegistry();
    reg.report('chrome', { kind: 'denied' });
    expect(reg.get('chrome').state).toBe('denied');
    expect(reg.get('safari').state).toBe('ok');
    expect(reg.get('app').state).toBe('ok');
    expect(reg.hasDenied()).toBe(true);
  });

  it('partial-grant: Chrome denied while Safari stays ok', () => {
    const reg = new HealthRegistry();
    reg.report('chrome', { kind: 'denied' });
    reg.report('safari', { kind: 'success' });
    expect(reg.get('chrome').state).toBe('denied');
    expect(reg.get('safari').state).toBe('ok');
  });

  it('notifies onChange listeners only on state transitions', () => {
    const reg = new HealthRegistry();
    const events: HealthChangeEvent[] = [];
    reg.onChange((e) => events.push(e));

    reg.report('chrome', { kind: 'transient' }); // ok -> degraded
    reg.report('chrome', { kind: 'transient' }); // degraded -> degraded (no event)
    reg.report('chrome', { kind: 'success' }); // degraded -> ok

    expect(events).toEqual([
      { source: 'chrome', previous: 'ok', current: 'degraded' },
      { source: 'chrome', previous: 'degraded', current: 'ok' },
    ]);
  });

  it('unsubscribe stops further notifications', () => {
    const reg = new HealthRegistry();
    const events: HealthChangeEvent[] = [];
    const off = reg.onChange((e) => events.push(e));
    reg.report('safari', { kind: 'denied' });
    off();
    reg.report('safari', { kind: 'success' });
    expect(events).toHaveLength(1);
  });

  it('all() returns sources in display order', () => {
    const reg = new HealthRegistry();
    expect(reg.all().map((h) => h.source)).toEqual(['app', 'chrome', 'safari']);
  });

  it('throws on an unknown source', () => {
    const reg = new HealthRegistry();
    // @ts-expect-error — exercising the runtime guard
    expect(() => reg.get('firefox')).toThrow(/unknown capture source/);
  });
});

describe('Korean user-facing strings', () => {
  it('trayStatusString renders Korean per state', () => {
    const reg = new HealthRegistry();
    expect(trayStatusString(reg.get('chrome'))).toBe('Chrome: 정상');

    reg.report('chrome', { kind: 'transient' });
    expect(trayStatusString(reg.get('chrome'))).toBe('Chrome: 불안정');

    reg.report('safari', { kind: 'denied' });
    expect(trayStatusString(reg.get('safari'))).toBe('Safari: 권한 필요');
  });

  it('trayStatusStrings covers every source', () => {
    const reg = new HealthRegistry();
    reg.report('chrome', { kind: 'denied' });
    expect(trayStatusStrings(reg)).toEqual([
      '앱: 정상',
      'Chrome: 권한 필요',
      'Safari: 정상',
    ]);
  });

  it('settingsLinkForSource returns a Korean deep-link label only when denied', () => {
    const reg = new HealthRegistry();
    expect(settingsLinkForSource(reg.get('chrome'))).toBeUndefined();

    reg.report('chrome', { kind: 'denied' });
    expect(settingsLinkForSource(reg.get('chrome'))).toBe(
      'Chrome 자동화 권한 필요 — 설정 열기',
    );

    reg.report('app', { kind: 'denied' });
    expect(settingsLinkForSource(reg.get('app'))).toBe(
      '손쉬운 사용 권한 필요 — 설정 열기',
    );
  });

  it('permissionKindForSource maps app -> accessibility and browsers -> automation', () => {
    expect(permissionKindForSource('app')).toBe('accessibility');
    expect(permissionKindForSource('chrome')).toBe('automation');
    expect(permissionKindForSource('safari')).toBe('automation');
  });
});
