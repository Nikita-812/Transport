import { describe, expect, it } from 'vitest';
import { parseRawForecast, type RouteId } from '../api/types';
import fixture from '../test/fixtures/forecast-real.json';
import { profile } from './aggregate';
import { DEFAULT_ASSUMPTIONS, headwayMinutes, planningRows, tripsPerHour } from './planning';
import { normalizeSeries, type RouteSeries } from './series';

const constant = (route: RouteId, days: number, fill: (day: number, hour: number) => number): RouteSeries => ({
  route, start: '2025-11-03', days, values: Float64Array.from({ length: days * 24 }, (_, index) => fill(Math.floor(index / 24), index % 24)),
});

describe('рейсы и интервал', () => {
  it('B = 1000 при значениях по умолчанию — 3 рейса в час и интервал 20 минут', () => {
    // 1000 × 0,35 = 350 одновременно едущих; 180 × 0,7 = 126 мест; ⌈350 / 126⌉ = 3; ⌊60 / 3⌋ = 20.
    const trips = tripsPerHour(1000, DEFAULT_ASSUMPTIONS);
    expect(trips).toBe(3);
    expect(headwayMinutes(trips)).toBe(20);
  });

  it('B = 0 — потребности нет, деления на ноль нет', () => {
    const trips = tripsPerHour(0, DEFAULT_ASSUMPTIONS);
    expect(trips).toBe(0);
    expect(headwayMinutes(trips)).toBeNull();
  });

  it('рейсы округляются вверх, интервал — вниз', () => {
    // Одна посадка за час — уже один рейс; 500 × 0,35 / 126 = 1,39; 2000 × 0,35 / 126 = 5,56.
    expect(tripsPerHour(1, DEFAULT_ASSUMPTIONS)).toBe(1);
    expect(tripsPerHour(500, DEFAULT_ASSUMPTIONS)).toBe(2);
    expect(tripsPerHour(2000, DEFAULT_ASSUMPTIONS)).toBe(6);
    expect(headwayMinutes(6)).toBe(10);
    expect(headwayMinutes(7)).toBe(8);
    expect(headwayMinutes(61)).toBe(0);
  });

  it('вместимость 250 вместо 180 уменьшает выпуск: 2 рейса и 30 минут', () => {
    const trips = tripsPerHour(1000, { ...DEFAULT_ASSUMPTIONS, capacity: 250 });
    expect(trips).toBe(2);
    expect(headwayMinutes(trips)).toBe(30);
  });

  it('нулевые допущения не дают деления на ноль', () => {
    expect(tripsPerHour(1000, { ...DEFAULT_ASSUMPTIONS, share: 0 })).toBe(0);
    expect(Number.isNaN(tripsPerHour(1000, { ...DEFAULT_ASSUMPTIONS, fill: 0 }))).toBe(true);
    expect(headwayMinutes(Number.NaN)).toBeNull();
  });
});

describe('строки выпуска по маршрутам', () => {
  it('на горизонте «День» — пиковый час этой даты, на периоде — среднего дня', () => {
    const series = [constant(17, 2, (day, hour) => (day === 0 ? hour : 0))];
    const [day] = planningRows([constant(17, 1, (_, hour) => hour)], { from: 0, to: 23 }, DEFAULT_ASSUMPTIONS);
    expect(day).toMatchObject({ route: 17, hour: 23, boardings: 23 });
    const [period] = planningRows(series, { from: 0, to: 23 }, DEFAULT_ASSUMPTIONS);
    // Средний день: 23 в первый день и 0 во второй дают 11,5.
    expect(period).toMatchObject({ route: 17, hour: 23, boardings: 11.5 });
  });

  it('пик ищется только внутри диапазона часов фильтра', () => {
    const [row] = planningRows([constant(17, 1, (_, hour) => hour)], { from: 6, to: 9 }, DEFAULT_ASSUMPTIONS);
    expect(row).toMatchObject({ hour: 9, boardings: 9 });
  });

  it('при равенстве пиком считается более ранний час', () => {
    const [row] = planningRows([constant(17, 1, () => 500)], { from: 0, to: 23 }, DEFAULT_ASSUMPTIONS);
    expect(row!.hour).toBe(0);
  });

  it('маршрут без посадок — ноль рейсов и нет интервала', () => {
    const [row] = planningRows([constant(5, 1, () => 0)], { from: 0, to: 23 }, DEFAULT_ASSUMPTIONS);
    expect(row).toMatchObject({ route: 5, hour: 0, boardings: 0, trips: 0, headway: null });
  });

  it('на реальном прогнозе пик совпадает с профилем часа суток', () => {
    const response = parseRawForecast(fixture.raw[1]!);
    const rows = response.rows.filter((row) => row.date === fixture.start);
    const series = [normalizeSeries(17, fixture.start, fixture.start, rows)];
    const hours = { from: 0, to: 23 };
    const expected = profile(series, 'hourOfDay', hours, true)
      .reduce((best, row) => (row.prediction > best.prediction ? row : best));
    const [row] = planningRows(series, hours, DEFAULT_ASSUMPTIONS);
    expect(row!.hour).toBe(Number(expected.key.slice(0, 2)));
    expect(row!.boardings).toBeCloseTo(expected.prediction, 6);
    expect(row!.trips).toBe(Math.ceil((expected.prediction * 0.35) / (180 * 0.7)));
  });
});
