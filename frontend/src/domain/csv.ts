// Выгрузка текущего вида (spec forecast-exploration, «CSV export»): UTF-8 с BOM, разделитель «;»,
// точка в дробной части. BOM нужен Excel: без него он читает файл в ANSI и портит русские подписи.
import type { ViewRow } from './aggregate';
import type { Granularity, Horizon } from './horizon';

export const CSV_BOM = '﻿';
const SEPARATOR = ';';
const NEWLINE = '\r\n';
/** Точность: прогнозы — 3 знака, коэффициент сценария — 4. */
const PREDICTION_DIGITS = 3;
const COEFFICIENT_DIGITS = 4;

/** Колонки периода по детализации; имена — как у серверного CSV (`route;date;hour;prediction`). */
function periodHeader(granularity: Granularity): string[] {
  return granularity === 'hour' ? ['date', 'hour'] : [granularity === 'day' ? 'date' : granularity];
}

function periodCells(key: string, granularity: Granularity): string[] {
  return granularity === 'hour' ? [key.slice(0, 10), String(Number(key.slice(11, 13)))] : [key];
}

export interface CsvView {
  granularity: Granularity;
  /** Разрез по маршрутам добавляет колонку `route`. */
  byRoute: boolean;
}

/**
 * Строки текущего вида в CSV. Значения формируются самим приложением — это числа, ISO-даты и
 * номера маршрутов, — поэтому экранирование разделителя не требуется.
 */
export function buildCsv(rows: readonly ViewRow[], view: CsvView): string {
  const header = [
    ...periodHeader(view.granularity),
    ...(view.byRoute ? ['route'] : []),
    'base_prediction', 'coefficient', 'prediction',
  ];
  const body = rows.map((row) => [
    ...periodCells(row.key, view.granularity),
    ...(view.byRoute ? [String(row.route ?? '')] : []),
    row.base.toFixed(PREDICTION_DIGITS),
    row.coefficient.toFixed(COEFFICIENT_DIGITS),
    row.prediction.toFixed(PREDICTION_DIGITS),
  ].join(SEPARATOR));
  return CSV_BOM + [header.join(SEPARATOR), ...body].join(NEWLINE) + NEWLINE;
}

/** Имя файла содержит горизонт и диапазон дат: `tram-forecast_month_2025-11-01_2025-11-30.csv`. */
export function csvFileName(horizon: Horizon, start: string, end: string): string {
  return `tram-forecast_${horizon}_${start}_${end}.csv`;
}
