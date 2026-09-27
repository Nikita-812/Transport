import { isIsoDate, type IsoDate, type RawForecastRow, type RouteId } from '../api/types';
import { daysInclusive, isoToUtcMs, DAY_MS } from './dates';

export interface RouteSeries {
  route: RouteId;
  start: IsoDate;
  days: number;
  values: Float64Array;
}

export class RouteDataError extends Error {
  constructor(route: RouteId, detail: string) {
    super(`Маршрут ${route}: ${detail}`);
    this.name = 'RouteDataError';
  }
}

/** Сетка обязана быть полной: отсутствующая ячейка никогда не превращается в ноль. */
export function normalizeSeries(route: RouteId, start: IsoDate, end: IsoDate, rows: readonly RawForecastRow[]): RouteSeries {
  const days = daysInclusive(start, end);
  if (!isIsoDate(start) || !isIsoDate(end) || days < 1) throw new RouteDataError(route, 'некорректный диапазон дат');
  const values = new Float64Array(days * 24).fill(Number.NaN);
  for (const row of rows) {
    if (row.route !== route || !isIsoDate(row.date) || row.date < start || row.date > end ||
      !Number.isInteger(row.hour) || row.hour < 0 || row.hour > 23 || !Number.isFinite(row.prediction) || row.prediction < 0) {
      throw new RouteDataError(route, 'строка вне запрошенной сетки или некорректное значение');
    }
    const index = ((isoToUtcMs(row.date) - isoToUtcMs(start)) / DAY_MS) * 24 + row.hour;
    if (!Number.isNaN(values[index])) throw new RouteDataError(route, 'повтор даты и часа');
    values[index] = row.prediction;
  }
  if (values.some(Number.isNaN)) throw new RouteDataError(route, 'неполная почасовая сетка прогноза');
  return { route, start, days, values };
}
