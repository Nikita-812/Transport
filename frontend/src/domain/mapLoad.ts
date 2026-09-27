// Нагрузка на карте (design D8, spec route-load-map «Load coloring» и «Routes through a stop»).
// Всё считается по рядам после сценария из `useScenarioSeries`; смена часа только выбирает готовое значение.
import type { RouteId } from '../api/types';
import { profile, type HourRange } from './aggregate';
import { formatInteger } from './format';
import type { RouteSeries } from './series';

export const LOAD_CLASS_COUNT = 5;
export const MIN_LINE_WIDTH = 2;
export const MAX_LINE_WIDTH = 10;

/**
 * Значения маршрута по часам суток, которые показывает карта: на горизонте «День» — прогноз этой даты,
 * на многодневном периоде — среднее за день для этого часа. Вне диапазона часов фильтра — `null`.
 */
export interface RouteHourLoad {
  route: RouteId;
  /** Индекс — час 0–23. */
  values: (number | null)[];
}

export function routeHourLoads(series: readonly RouteSeries[], hours: HourRange): RouteHourLoad[] {
  const rows = profile(series, 'hourOfDay', hours, true);
  return series.map((item) => {
    const values = Array<number | null>(24).fill(null);
    for (const row of rows) if (row.route === item.route) values[Number(row.key.slice(0, 2))] = row.prediction;
    return { route: item.route, values };
  });
}

/** Классы нагрузки: 4 границы квантилей 20/40/60/80 % и крайние значения. */
export interface LoadScale {
  breaks: number[];
  min: number;
  max: number;
}

/** Квантиль отсортированного массива с линейной интерполяцией (как `numpy.quantile` по умолчанию). */
function quantile(sorted: readonly number[], p: number): number {
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
}

/**
 * Шкала по всем показанным значениям «маршрут × час» выбранных маршрутов (spec: квантили отображаемых
 * значений после сценария). Классы общие для всех часов, поэтому ночью линии уходят в нижние классы.
 */
export function loadScale(loads: readonly RouteHourLoad[]): LoadScale | null {
  const values = loads.flatMap((load) => load.values.filter((value): value is number => value !== null)).sort((a, b) => a - b);
  if (!values.length) return null;
  return {
    breaks: Array.from({ length: LOAD_CLASS_COUNT - 1 }, (_, index) => quantile(values, (index + 1) / LOAD_CLASS_COUNT)),
    min: values[0]!,
    max: values[values.length - 1]!,
  };
}

/** Класс 0–4: число границ, не превышающих значение. Если все значения равны, классов нет — класс 0. */
export function loadClass(value: number, scale: LoadScale): number {
  if (scale.max === scale.min) return 0;
  return scale.breaks.filter((edge) => value >= edge).length;
}

/** Толщина 2–10 px, пропорциональная √значения: максимум шкалы — 10 px. */
export function lineWidth(value: number, scale: LoadScale): number {
  if (scale.max <= 0) return MIN_LINE_WIDTH;
  const width = MAX_LINE_WIDTH * Math.sqrt(Math.max(0, value) / scale.max);
  return Math.min(MAX_LINE_WIDTH, Math.max(MIN_LINE_WIDTH, width));
}

/** Границы классов для легенды, посадок в час. */
export function legendRanges(scale: LoadScale): { from: number; to: number }[] {
  const edges = [scale.min, ...scale.breaks, scale.max];
  return edges.slice(0, -1).map((from, index) => ({ from, to: edges[index + 1]! }));
}

/** «322 – 1 129»; если границы совпадают после округления (например, ночные нули) — одно число. */
export function formatLoadRange(range: { from: number; to: number }): string {
  const from = formatInteger(range.from);
  const to = formatInteger(range.to);
  return from === to ? from : `${from} – ${to}`;
}

/** Час карты внутри диапазона часов фильтра. */
export function clampHour(hour: number, hours: HourRange): number {
  return Math.min(hours.to, Math.max(hours.from, hour));
}

/** Следующий час проигрывания: по кругу внутри диапазона часов фильтра. */
export function nextPlaybackHour(hour: number, hours: HourRange): number {
  const current = clampHour(hour, hours);
  return current >= hours.to ? hours.from : current + 1;
}

export interface StopHourProfile {
  /** Часы диапазона фильтра по возрастанию. */
  hours: number[];
  /** Сумма прогнозов маршрутов по часу: за выбранный день или в среднем за день периода. */
  values: number[];
  total: number;
  peak: { hour: number; value: number } | null;
}

/**
 * Профиль остановки — сумма прогнозов маршрутов, проходящих через неё, а не посадки на остановке:
 * прогноза по остановкам у сервиса нет. Маршруты без загруженных данных в сумму не входят.
 */
export function stopHourProfile(series: readonly RouteSeries[], routes: readonly RouteId[], hours: HourRange): StopHourProfile {
  const rows = profile(series.filter((item) => routes.includes(item.route)), 'hourOfDay', hours, false);
  const points = rows.map((row) => ({ hour: Number(row.key.slice(0, 2)), value: row.prediction }));
  // При равенстве пиком считается более ранний час, как у KPI.
  const peak = points.reduce<{ hour: number; value: number } | null>((best, point) => (best === null || point.value > best.value ? point : best), null);
  return {
    hours: points.map((point) => point.hour),
    values: points.map((point) => point.value),
    total: points.reduce((sum, point) => sum + point.value, 0),
    peak,
  };
}
