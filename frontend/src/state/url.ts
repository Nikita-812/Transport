import { isIsoDate, isRouteId, ROUTES, type Coverage, type RouteId } from '../api/types';
import { validHours, type HourRange } from '../domain/aggregate';
import { formatIsoDate } from '../domain/format';
import { clampDate, defaultGranularity, GRANULARITIES, HORIZONS, nowSelection, resolveRange, type Granularity, type Horizon } from '../domain/horizon';
import { isTabId, type TabId } from './tabs';

export interface Filters {
  routes: RouteId[];
  horizon: Horizon;
  start: string;
  end: string;
  hours: HourRange;
  granularity: Granularity;
  split: 'routes' | 'total';
}

export function defaultFilters(coverage: Coverage): Filters {
  const { date } = nowSelection(coverage);
  return { routes: [...ROUTES], horizon: 'day', start: date, end: date, hours: { from: 0, to: 23 }, granularity: 'hour', split: 'routes' };
}

const KEYS = ['routes', 'h', 'start', 'end', 'hours', 'g', 'split', 'tab'];

/** URL → проверка типов и покрытия → готовое состояние. Никогда не запрашиваем сырые параметры URL. */
export function parseUrl(search: string, coverage: Coverage) {
  const params = new URLSearchParams(search);
  const filters = defaultFilters(coverage);
  const warnings: string[] = [];
  const invalid = (key: string) => warnings.push(`Некорректный параметр «${key}» проигнорирован.`);
  for (const key of new Set(params.keys())) if (!KEYS.includes(key)) invalid(key);
  const read = (key: string): string | null => {
    if (params.getAll(key).length > 1) { invalid(key); return null; }
    return params.get(key);
  };
  const routes = read('routes');
  if (routes !== null) {
    const values = routes === '' ? [] : routes.split(',').map((value) => /^\d+$/.test(value) ? Number(value) : NaN);
    if (values.every(isRouteId)) filters.routes = [...new Set(values)].sort((a, b) => a - b);
    else invalid('routes');
  }
  const horizon = read('h');
  if (horizon !== null) {
    if (HORIZONS.includes(horizon as Horizon)) filters.horizon = horizon as Horizon;
    else invalid('h');
  }
  for (const [key, value] of [['start', read('start')], ['end', read('end')]] as const) {
    if (value === null) continue;
    if (!isIsoDate(value)) { invalid(key); continue; }
    filters[key] = clampDate(value, coverage);
    if (filters[key] !== value) warnings.push(`Дата «${key}» вне покрытия. Доступны даты с ${formatIsoDate(coverage.start)} по ${formatIsoDate(coverage.end)}; выбрана ближайшая допустимая дата.`);
  }
  if (filters.horizon === 'period' && filters.end < filters.start) {
    filters.end = filters.start;
    warnings.push('Дата окончания раньше даты начала; выбран один день.');
  }
  const range = resolveRange(filters.horizon, filters.start, filters.end, coverage);
  if (filters.horizon !== 'period' && params.has('end') && isIsoDate(params.get('end')) && filters.end !== range.end) invalid('end');
  filters.end = range.end;
  filters.granularity = defaultGranularity(filters.horizon, range);
  const hours = read('hours');
  if (hours !== null) {
    const match = /^(\d{1,2})-(\d{1,2})$/.exec(hours);
    const parsed = { from: Number(match?.[1]), to: Number(match?.[2]) };
    if (match && validHours(parsed)) filters.hours = parsed;
    else invalid('hours');
  }
  const granularity = read('g');
  if (granularity !== null) {
    if (GRANULARITIES.includes(granularity as Granularity)) filters.granularity = granularity as Granularity;
    else invalid('g');
  }
  const split = read('split');
  if (split !== null) {
    if (split === 'routes' || split === 'total') filters.split = split;
    else invalid('split');
  }
  let tab: TabId = 'overview';
  const parsedTab = read('tab');
  if (parsedTab !== null) {
    if (isTabId(parsedTab)) tab = parsedTab;
    else invalid('tab');
  }
  const nowMode = !KEYS.filter((key) => key !== 'tab').some((key) => params.has(key));
  return { filters, tab, warnings, nowMode };
}

export function serializeUrl(filters: Filters, tab: TabId): string {
  return new URLSearchParams({ routes: filters.routes.join(','), h: filters.horizon, start: filters.start, end: filters.end,
    hours: `${filters.hours.from}-${filters.hours.to}`, g: filters.granularity, split: filters.split, tab }).toString();
}
