/**
 * Timeline renderer — lists recorded activities (plan Work Unit E).
 *
 * On mount it calls `window.wdiot.query()` (the `timeline:query` IPC channel)
 * and renders the returned `Activity[]` newest-first. Pure presentation; the
 * main process owns the SQLite slice.
 */
import { useEffect, useState, type JSX } from 'react';
import type { Activity } from '@wdiot/shared';
import { timelineBridge } from './bridge.js';

/** Load lifecycle of the timeline view. */
type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; activities: Activity[] }
  | { status: 'error' };

/** Format an epoch-ms timestamp as a short Korean local time. */
function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Korean label for an activity type. */
function activityTypeLabel(type: Activity['type']): string {
  switch (type) {
    case 'app_switch':
      return '앱 전환';
    case 'browser_tab':
      return '브라우저 탭';
    case 'file_edit':
      return '파일 편집';
    case 'search':
      return '검색';
  }
}

/** One-line Korean summary of an activity's payload. */
function activitySummary(activity: Activity): string {
  switch (activity.type) {
    case 'app_switch':
      return activity.payload.windowTitle
        ? `${activity.payload.appName} — ${activity.payload.windowTitle}`
        : activity.payload.appName;
    case 'browser_tab':
      return activity.payload.title || activity.payload.url;
    case 'file_edit':
      return activity.payload.filePath;
    case 'search':
      return `'${activity.payload.query}'`;
  }
}

/** The timeline root component. */
export function App(): JSX.Element {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void timelineBridge()
      .query()
      .then(({ activities }) => {
        if (cancelled) return;
        // Newest first for a recency-oriented view.
        const sorted = [...activities].sort((a, b) => b.ts - a.ts);
        setState({ status: 'ready', activities: sorted });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main
      data-testid="timeline-root"
      className="min-h-screen bg-slate-950 p-6 text-slate-100"
    >
      <h1 className="mb-4 text-lg font-semibold">타임라인</h1>

      {state.status === 'loading' && (
        <p data-testid="timeline-loading" className="text-sm text-slate-400">
          불러오는 중...
        </p>
      )}

      {state.status === 'error' && (
        <p data-testid="timeline-error" className="text-sm text-rose-300">
          타임라인을 불러오지 못했습니다.
        </p>
      )}

      {state.status === 'ready' && state.activities.length === 0 && (
        <p data-testid="timeline-empty" className="text-sm text-slate-400">
          기록된 활동이 없습니다.
        </p>
      )}

      {state.status === 'ready' && state.activities.length > 0 && (
        <ul data-testid="timeline-list" className="space-y-1.5">
          {state.activities.map((activity) => (
            <li
              key={activity.id}
              data-testid="timeline-item"
              className="flex items-baseline gap-3 rounded-md bg-slate-900 px-3 py-2"
            >
              <span className="w-28 shrink-0 text-xs text-slate-500">
                {formatTime(activity.ts)}
              </span>
              <span className="w-20 shrink-0 text-xs font-medium text-sky-400">
                {activityTypeLabel(activity.type)}
              </span>
              <span className="truncate text-sm text-slate-200">
                {activitySummary(activity)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
