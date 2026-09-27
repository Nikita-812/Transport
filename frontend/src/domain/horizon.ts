import type { Coverage, IsoDate } from '../api/types';
import { addDays, addMonthsClamped, daysInclusive, moscowNow } from './dates';

export const HORIZONS = ['day', 'month', 'year', 'period'] as const;
export type Horizon = (typeof HORIZONS)[number];
export const GRANULARITIES = ['hour', 'day', 'week', 'month'] as const;
export type Granularity = (typeof GRANULARITIES)[number];
export interface DateRange { start: IsoDate; end: IsoDate }

export function horizonEnd(start: IsoDate, horizon: Exclude<Horizon, 'period'>): IsoDate {
  return horizon === 'day' ? start : addDays(addMonthsClamped(start, horizon === 'month' ? 1 : 12), -1);
}

export function clampDate(date: IsoDate, coverage: Coverage): IsoDate {
  return date < coverage.start ? coverage.start : date > coverage.end ? coverage.end : date;
}

export function resolveRange(horizon: Horizon, start: IsoDate, end: IsoDate, coverage: Coverage) {
  const requestedEnd = horizon === 'period' ? end : horizonEnd(start, horizon);
  const range = { start: clampDate(start, coverage), end: clampDate(requestedEnd, coverage) };
  return { ...range, clipped: range.start !== start || range.end !== requestedEnd };
}

export function defaultGranularity(horizon: Horizon, range: DateRange): Granularity {
  if (horizon === 'day') return 'hour';
  if (horizon === 'month') return 'day';
  if (horizon === 'year') return 'week';
  const days = daysInclusive(range.start, range.end);
  return days <= 2 ? 'hour' : days <= 92 ? 'day' : 'week';
}

export function nowSelection(coverage: Coverage) {
  const now = moscowNow();
  const outsideCoverage = now.date < coverage.start || now.date > coverage.end;
  return { date: outsideCoverage ? coverage.start : now.date, hour: now.hour, outsideCoverage };
}
