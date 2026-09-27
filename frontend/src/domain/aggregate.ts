import type { RouteId } from '../api/types';
import { addDays, isoWeek, season, weekday } from './dates';
import type { Granularity } from './horizon';
import type { RouteSeries } from './series';

export interface HourRange { from: number; to: number }
export const ALL_HOURS: HourRange = { from: 0, to: 23 };
export type BucketKind = Granularity | 'hourOfDay' | 'weekday' | 'season';
export interface AggregateRow { key: string; route: RouteId | null; prediction: number }

export function validHours(hours: HourRange): boolean {
  return Number.isInteger(hours.from) && Number.isInteger(hours.to) && hours.from >= 0 && hours.to <= 23 && hours.from <= hours.to;
}

export function hourLabel(hour: number): string { return `${String(hour).padStart(2, '0')}:00`; }

function bucketKey(date: string, hour: number, kind: BucketKind): string {
  switch (kind) {
    case 'hour': return `${date}T${hourLabel(hour)}`;
    case 'day': return date;
    case 'week': return isoWeek(date);
    case 'month': return date.slice(0, 7);
    case 'hourOfDay': return hourLabel(hour);
    case 'weekday': return String(weekday(date));
    case 'season': return season(date);
  }
}

/** Общий проход используется для KPI и всех корзин; никакого округления. */
function visit(series: readonly RouteSeries[], hours: HourRange, fn: (route: RouteId, date: string, hour: number, value: number) => void) {
  if (!validHours(hours)) throw new Error('Часы должны задавать включительный диапазон от 0 до 23');
  for (const item of series) {
    for (let day = 0; day < item.days; day++) {
      const date = addDays(item.start, day);
      for (let hour = hours.from; hour <= hours.to; hour++) fn(item.route, date, hour, item.values[day * 24 + hour]!);
    }
  }
}

/** Суммы, совместимые с group_by API. hour — временная ось; hourOfDay — серверный hour. */
export function aggregate(series: readonly RouteSeries[], kind: BucketKind, hours: HourRange = ALL_HOURS, byRoute = false): AggregateRow[] {
  const buckets = new Map<string, AggregateRow>();
  visit(series, hours, (route, date, hour, value) => {
    const key = bucketKey(date, hour, kind);
    const id = `${byRoute ? route : 'all'}:${key}`;
    const row = buckets.get(id) ?? { key, route: byRoute ? route : null, prediction: 0 };
    row.prediction += value;
    buckets.set(id, row);
  });
  return [...buckets.values()].sort((a, b) => (a.route ?? 0) - (b.route ?? 0) || a.key.localeCompare(b.key));
}

/** Средние профили: знаменатель — календарные дни, а не число маршрутов/строк. */
export function profile(series: readonly RouteSeries[], kind: 'hourOfDay' | 'weekday', hours: HourRange = ALL_HOURS, byRoute = false): AggregateRow[] {
  const dates = new Map<string, Set<string>>();
  for (const item of series) {
    const id = byRoute ? String(item.route) : 'all';
    const set = dates.get(id) ?? new Set<string>();
    for (let day = 0; day < item.days; day++) set.add(addDays(item.start, day));
    dates.set(id, set);
  }
  return aggregate(series, kind, hours, byRoute).map((row) => {
    const days = [...dates.get(row.route === null ? 'all' : String(row.route))!];
    const count = kind === 'hourOfDay' ? days.length : days.filter((day) => String(weekday(day)) === row.key).length;
    return { ...row, prediction: row.prediction / count };
  });
}

export interface Kpis {
  total: number;
  averagePerHour: number;
  peak: { date: string; hour: number; prediction: number } | null;
  busiestRoute: { route: RouteId; prediction: number } | null;
}

export function calculateKpis(series: readonly RouteSeries[], hours: HourRange = ALL_HOURS): Kpis {
  const timeline = new Map<string, { date: string; hour: number; prediction: number }>();
  const totals = new Map<RouteId, number>();
  let total = 0;
  visit(series, hours, (route, date, hour, value) => {
    total += value;
    totals.set(route, (totals.get(route) ?? 0) + value);
    const key = `${date}T${hourLabel(hour)}`;
    const point = timeline.get(key) ?? { date, hour, prediction: 0 };
    point.prediction += value;
    timeline.set(key, point);
  });
  // При равенстве: первый час по времени и маршрут с меньшим номером.
  const peak = [...timeline.values()].sort((a, b) => b.prediction - a.prediction || a.date.localeCompare(b.date) || a.hour - b.hour)[0] ?? null;
  const busiestRoute = [...totals].map(([route, prediction]) => ({ route, prediction })).sort((a, b) => b.prediction - a.prediction || a.route - b.route)[0] ?? null;
  return { total, averagePerHour: timeline.size ? total / timeline.size : 0, peak, busiestRoute };
}
