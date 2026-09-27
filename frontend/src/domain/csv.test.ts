import { describe, expect, it } from 'vitest';
import { parseRawForecast } from '../api/types';
import fixture from '../test/fixtures/forecast-real.json';
import { aggregate, calculateKpis, viewRows } from './aggregate';
import { buildCsv, csvFileName, CSV_BOM } from './csv';
import { normalizeSeries } from './series';

const series = fixture.raw.map((body) => {
  const response = parseRawForecast(body);
  return normalizeSeries(response.routes[0]!, fixture.start, fixture.end, response.rows);
});

function rowsOf(granularity: 'hour' | 'day' | 'week' | 'month', byRoute: boolean, hours = { from: 0, to: 23 }) {
  return viewRows(aggregate(series, granularity, hours, byRoute));
}

describe('сериализация CSV текущего вида', () => {
  it('BOM, разделитель «;», точка в дробях, 3 знака у прогноза и 4 у коэффициента', () => {
    const rows = rowsOf('day', true);
    const csv = buildCsv(rows, { granularity: 'day', byRoute: true });
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(CSV_BOM).toBe('﻿');
    const lines = csv.slice(CSV_BOM.length).trimEnd().split('\r\n');
    expect(lines[0]).toBe('date;route;base_prediction;coefficient;prediction');
    expect(lines).toHaveLength(rows.length + 1);
    const first = lines[1]!.split(';');
    expect(first[0]).toBe('2025-11-01');
    expect(first[1]).toBe('1');
    expect(first[2]).toMatch(/^\d+\.\d{3}$/);
    expect(first[3]).toBe('1.0000');
    expect(first[2]).toBe(first[4]);
    expect(Number(first[2])).toBeCloseTo(rows[0]!.base, 3);
    expect(csv.includes(',')).toBe(false);
  });

  it('колонки периода повторяют серверный CSV: дата и час, дата, неделя, месяц', () => {
    const header = (granularity: 'hour' | 'day' | 'week' | 'month') =>
      buildCsv(rowsOf(granularity, false), { granularity, byRoute: false }).slice(CSV_BOM.length).split('\r\n')[0];
    expect(header('hour')).toBe('date;hour;base_prediction;coefficient;prediction');
    expect(header('day')).toBe('date;base_prediction;coefficient;prediction');
    expect(header('week')).toBe('week;base_prediction;coefficient;prediction');
    expect(header('month')).toBe('month;base_prediction;coefficient;prediction');
  });

  it('часовая строка разносит дату и целый час', () => {
    const csv = buildCsv(rowsOf('hour', false), { granularity: 'hour', byRoute: false });
    const lines = csv.slice(CSV_BOM.length).trimEnd().split('\r\n');
    expect(lines[1]!.split(';').slice(0, 2)).toEqual(['2025-11-01', '0']);
    expect(lines[9]!.split(';').slice(0, 2)).toEqual(['2025-11-01', '8']);
  });

  it('сумма колонки prediction равна итогу на экране', () => {
    const hours = { from: 7, to: 10 };
    const rows = rowsOf('day', true, hours);
    const csv = buildCsv(rows, { granularity: 'day', byRoute: true });
    const total = csv.slice(CSV_BOM.length).trimEnd().split('\r\n').slice(1)
      .reduce((sum, line) => sum + Number(line.split(';')[4]), 0);
    expect(total).toBeCloseTo(calculateKpis(series, hours).total, 1);
  });

  it('пустой вид даёт файл с одной строкой заголовка', () => {
    expect(buildCsv([], { granularity: 'day', byRoute: false })).toBe(`${CSV_BOM}date;base_prediction;coefficient;prediction\r\n`);
  });

  it('имя файла содержит горизонт и диапазон дат', () => {
    expect(csvFileName('month', '2025-11-01', '2025-11-30')).toBe('tram-forecast_month_2025-11-01_2025-11-30.csv');
    expect(csvFileName('day', '2026-10-31', '2026-10-31')).toBe('tram-forecast_day_2026-10-31_2026-10-31.csv');
  });
});
