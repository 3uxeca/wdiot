/**
 * Skeleton / shimmer primitive — shared by the palette's phase-1 placeholders.
 *
 * Pure presentation: a pulsing block used while phase-2 LLM data is in flight.
 */
import type { JSX } from 'react';

export interface SkeletonProps {
  /** extra Tailwind classes (sizing, rounding) supplied by the caller */
  className?: string;
  /** optional `data-testid` for tests */
  testId?: string;
}

/** A single shimmering placeholder block. */
export function Skeleton({ className = '', testId }: SkeletonProps): JSX.Element {
  return (
    <div
      data-testid={testId}
      className={`animate-pulse rounded bg-slate-700/60 ${className}`}
    />
  );
}
