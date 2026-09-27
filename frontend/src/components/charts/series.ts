// Подготовка данных графиков: чистые функции без ECharts и темы, поэтому проверяются тестами.
// Все суммы и средние берутся из `domain/aggregate.ts` (раздел 2) и здесь не считаются заново.
import type { IsoDate, RouteId } from '../../api/types';
import { calendarDay, daysOffBetween } from '../../data/calendar';
import { ROUTE_COLORS } from '../../data/route-colors';
import { aggregate, hourLabel, profile, weekdayHourProfile, type AggregateRow, type HourRange } from '../../domain/aggregate';
import { isoWeek } from '../../domain/dates';
import { formatBucketLabel, formatBucketTitle, formatWeekdayShort } from '../../domain/format';
import type { Granularity } from '../../domain/horizon';
import type { RouteSeries } from '../../domain/series';

/** Порог, с которого ряд получает `dataZoom` (design D10). */
export const ZOOM_THRESHOLD = 60;

export type Split = 'routes' | 'total';

export interface ChartLine {
  /** Маршрут или `null` для разреза «Итог». */
  route: RouteId | null;
  name: string;
  color: string;
  values: number[];
}

export interface HolidayMark {
  name: string;
  /** Индексы первой и последней корзины, которые покрывает отметка. */
  from: number;
  to: number;
}

export interface DynamicsData {
  granularity: Granularity;
  keys: string[];
  /** Короткие подписи оси. */
  labels: string[];
  /** Полные подписи для подсказки. */
  titles: string[];
  /** Пояснение календаря для корзины: праздник, перенос или предпраздничный день. */
  notes: (string | null)[];
  lines: ChartLine[];
  marks: HolidayMark[];
  zoom: boolean;
}

interface LineOptions {
  hours: HourRange;
  split: Split;
  /** Цвет линии «Итог» задаёт тема графика: маршрутная палитра к итогу не относится. */
  totalColor: string;
}

function lineColor(route: RouteId | null, totalColor: string): string {
  return route === null ? totalColor : ROUTE_COLORS[route];
}

function lineName(route: RouteId | null): string {
  return route === null ? 'Итог' : `Маршрут ${route}`;
}

/** Ключи корзин по возрастанию: у всех корзин лексикографический порядок совпадает с хронологическим. */
function orderedKeys(rows: readonly AggregateRow[]): string[] {
  return [...new Set(rows.map((row) => row.key))].sort((a, b) => a.localeCompare(b));
}

function toLines(rows: readonly AggregateRow[], keys: readonly string[], totalColor: string): ChartLine[] {
  const routes = [...new Set(rows.map((row) => row.route))];
  const index = new Map(keys.map((key, position) => [key, position]));
  return routes.map((route) => {
    const values = Array<number>(keys.length).fill(0);
    for (const row of rows) {
      if (row.route !== route) continue;
      const position = index.get(row.key);
      if (position !== undefined) values[position] = row.prediction;
    }
    return { route, name: lineName(route), color: lineColor(route, totalColor), values };
  });
}

/** Корзины даты на выбранной детализации: у часовой детализации это первая и последняя корзина дня. */
function dateBucketKeys(date: IsoDate, granularity: Granularity, hours: HourRange): [string, string] {
  switch (granularity) {
    case 'hour': return [`${date}T${hourLabel(hours.from)}`, `${date}T${hourLabel(hours.to)}`];
    case 'day': return [date, date];
    case 'week': return [isoWeek(date), isoWeek(date)];
    case 'month': return [date.slice(0, 7), date.slice(0, 7)];
  }
}

/**
 * Отметки праздников и перенесённых выходных. Соседние по корзинам нерабочие дни объединяются в одну
 * полосу, а её название перечисляет попавшие праздники: новогодние каникулы вместе с Рождеством
 * Христовым остаются одной отметкой, а на недельной оси не появляется двух полос на одной неделе.
 */
export function holidayMarks(
  start: IsoDate, end: IsoDate, granularity: Granularity, hours: HourRange, keys: readonly string[],
): HolidayMark[] {
  const index = new Map(keys.map((key, position) => [key, position]));
  const marks: { names: string[]; from: number; to: number }[] = [];
  for (const day of daysOffBetween(start, end)) {
    const [firstKey, lastKey] = dateBucketKeys(day.date, granularity, hours);
    const first = index.get(firstKey);
    const last = index.get(lastKey);
    if (first === undefined || last === undefined) continue;
    const previous = marks.at(-1);
    if (previous && first <= previous.to + 1) {
      previous.to = Math.max(previous.to, last);
      if (!previous.names.includes(day.name)) previous.names.push(day.name);
    } else {
      marks.push({ names: [day.name], from: first, to: last });
    }
  }
  return marks.map(({ names, from, to }) => ({ name: names.join(', '), from, to }));
}

/** Даты корзины — для пояснений календаря; для недель и месяцев это все её дни в диапазоне. */
function bucketNote(key: string, granularity: Granularity, start: IsoDate, end: IsoDate, hours: HourRange): string | null {
  if (granularity === 'hour' || granularity === 'day') {
    const date = granularity === 'hour' ? key.slice(0, 10) : key;
    return calendarDay(date)?.name ?? null;
  }
  const names = daysOffBetween(start, end)
    .filter((day) => dateBucketKeys(day.date, granularity, hours)[0] === key)
    .map((day) => day.name);
  return names.length ? [...new Set(names)].join(', ') : null;
}

/** График динамики: линии по маршрутам или итог на оси выбранной детализации. */
export function buildDynamics(
  series: readonly RouteSeries[], granularity: Granularity, range: { start: IsoDate; end: IsoDate }, options: LineOptions,
): DynamicsData {
  const rows = aggregate(series, granularity, options.hours, options.split === 'routes');
  const keys = orderedKeys(rows);
  return {
    granularity,
    keys,
    labels: keys.map((key) => formatBucketLabel(key, granularity)),
    titles: keys.map((key) => formatBucketTitle(key, granularity)),
    notes: keys.map((key) => bucketNote(key, granularity, range.start, range.end, options.hours)),
    lines: toLines(rows, keys, options.totalColor),
    marks: holidayMarks(range.start, range.end, granularity, options.hours, keys),
    zoom: keys.length > ZOOM_THRESHOLD,
  };
}

export interface HourProfileData {
  hours: number[];
  labels: string[];
  lines: ChartLine[];
}

/** Профиль «час суток»: среднее за день по каждому часу выбранного диапазона. */
export function buildHourProfile(series: readonly RouteSeries[], options: LineOptions): HourProfileData {
  const rows = profile(series, 'hourOfDay', options.hours, options.split === 'routes');
  const keys = orderedKeys(rows);
  return {
    hours: keys.map((key) => Number(key.slice(0, 2))),
    labels: keys,
    lines: toLines(rows, keys, options.totalColor),
  };
}

export interface HeatmapData {
  hourLabels: string[];
  /** Дни недели сверху вниз: понедельник первым, как в spec forecast-exploration. */
  weekdayLabels: string[];
  /** `[индекс часа, индекс дня недели, среднее за день]`. */
  cells: [number, number, number][];
  min: number;
  max: number;
}

/** Тепловая карта «день недели × час», среднее за день. */
export function buildHeatmap(series: readonly RouteSeries[], hours: HourRange): HeatmapData {
  const profileCells = weekdayHourProfile(series, hours);
  const hourValues = [...new Set(profileCells.map((cell) => cell.hour))].sort((a, b) => a - b);
  const weekdays = [...new Set(profileCells.map((cell) => cell.weekday))].sort((a, b) => b - a);
  const cells = profileCells.map(
    (cell): [number, number, number] => [hourValues.indexOf(cell.hour), weekdays.indexOf(cell.weekday), cell.prediction],
  );
  const values = profileCells.map((cell) => cell.prediction);
  return {
    hourLabels: hourValues.map(hourLabel),
    weekdayLabels: weekdays.map(formatWeekdayShort),
    cells,
    min: values.length ? Math.min(...values) : 0,
    max: values.length ? Math.max(...values) : 0,
  };
}
