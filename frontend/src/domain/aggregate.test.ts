import { describe, expect, it } from 'vitest';
import { parseAggregateForecast, parseRawForecast } from '../api/types';
import fixture from '../test/fixtures/forecast-real.json';
import { normalizeSeries, type RouteSeries } from './series';
import { aggregate, calculateKpis, profile } from './aggregate';

const manual: RouteSeries[] = [
  { route: 1, start: '2025-11-02', days: 2, values: new Float64Array(48).fill(1) },
  { route: 17, start: '2025-11-02', days: 2, values: new Float64Array(48).fill(2) },
];

describe('агрегаты без округления', () => {
  it('включительные часы 7–10, разрез и итог', () => {
    const hours = { from: 7, to: 10 };
    expect(aggregate(manual, 'day', hours)).toEqual([
      { key: '2025-11-02', route: null, prediction: 12 }, { key: '2025-11-03', route: null, prediction: 12 },
    ]);
    expect(aggregate(manual, 'day', hours, true).map((r) => r.prediction)).toEqual([4, 4, 8, 8]);
    for (const kind of ['hour', 'day', 'week', 'month', 'hourOfDay', 'weekday', 'season'] as const) {
      expect(aggregate(manual, kind, hours).reduce((sum, r) => sum + r.prediction, 0)).toBe(24);
    }
    expect(() => aggregate(manual, 'day', { from: 10, to: 7 })).toThrow();
  });
  it('профили делятся на дни, а не на маршруты; дни недели — по числу их вхождений', () => {
    const hours = { from: 7, to: 10 };
    expect(profile(manual, 'hourOfDay', hours).map((r) => r.prediction)).toEqual([3, 3, 3, 3]);
    expect(profile(manual, 'weekday', hours)).toEqual([
      { key: '0', route: null, prediction: 12 }, { key: '6', route: null, prediction: 12 },
    ]);
    const nineDays = [{ ...manual[0]!, days: 9, values: new Float64Array(9 * 24).fill(2) }];
    expect(profile(nineDays, 'weekday').map((r) => r.prediction)).toEqual(Array<number>(7).fill(48));
    expect(profile(manual, 'weekday', hours, true).map((r) => r.prediction)).toEqual([4, 4, 8, 8]);
  });
  it('KPI: пик суммарного ряда и среднее по временным часам', () => {
    const result = calculateKpis(manual, { from: 7, to: 10 });
    expect(result).toEqual({ total: 24, averagePerHour: 3, peak: { date: '2025-11-02', hour: 7, prediction: 3 }, busiestRoute: { route: 17, prediction: 16 } });
    expect(calculateKpis([])).toEqual({ total: 0, averagePerHour: 0, peak: null, busiestRoute: null });
    const peakSeries = manual.map((s) => ({ ...s, values: s.values.slice() }));
    peakSeries[0]!.values[7] = 20;
    peakSeries[1]!.values[8] = 15;
    expect(calculateKpis(peakSeries).peak).toEqual({ date: '2025-11-02', hour: 7, prediction: 22 });
  });
  it('сезоны и ISO-недели на границе года', () => {
    const data = [{ ...manual[0]!, start: '2025-12-31' }];
    expect(aggregate(data, 'week')).toEqual([{ key: '2026-W01', route: null, prediction: 48 }]);
    expect(aggregate(data, 'season')).toEqual([{ key: 'winter', route: null, prediction: 48 }]);
  });
});

describe('согласованность с реальным бекендом, маршруты 1 и 17, семь дней', () => {
  const data = fixture.raw.map((body) => {
    const response = parseRawForecast(body);
    return normalizeSeries(response.routes[0]!, fixture.start, fixture.end, response.rows);
  });
  for (const body of fixture.aggregates) {
    it(`group_by=${body.group_by}, допуск ±0,5`, () => {
      const response = parseAggregateForecast(body);
      const kind = response.group_by;
      if (kind !== 'day' && kind !== 'week' && kind !== 'weekday') throw new Error('Неожиданная фикстура');
      const client = aggregate(data, kind);
      expect(client).toHaveLength(response.rows.length);
      response.rows.forEach((row, index) => {
        expect(client[index]!.key).toBe(Reflect.get(row, kind));
        expect(Math.abs(client[index]!.prediction - row.prediction)).toBeLessThanOrEqual(0.5);
      });
      expect(response.forecast_version).toBe(fixture.health.forecast_version);
    });
  }
});
