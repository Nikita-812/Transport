import { describe, expect, it } from 'vitest';
import { parseAggregateForecast, parseRawForecast } from '../api/types';
import fixture from '../test/fixtures/forecast-real.json';
import { normalizeSeries, type RouteSeries } from './series';
import { aggregate, calculateKpis, profile, viewRows, weekdayHourProfile } from './aggregate';

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

describe('тепловая карта и строки вида', () => {
  it('«день недели × час» делит на число дней этого дня недели, а не на число маршрутов', () => {
    const cells = weekdayHourProfile(manual, { from: 7, to: 8 });
    // 2025-11-02 — воскресенье (6), 2025-11-03 — понедельник (0); в каждом дне по одному разу.
    expect(cells).toEqual([
      { weekday: 0, hour: 7, prediction: 3 }, { weekday: 0, hour: 8, prediction: 3 },
      { weekday: 6, hour: 7, prediction: 3 }, { weekday: 6, hour: 8, prediction: 3 },
    ]);
    const nineDays = [{ ...manual[0]!, days: 9, values: new Float64Array(9 * 24).fill(2) }];
    const monday = weekdayHourProfile(nineDays, { from: 8, to: 8 }).filter((cell) => cell.weekday === 0);
    expect(monday).toEqual([{ weekday: 0, hour: 8, prediction: 2 }]);
    expect(weekdayHourProfile([])).toEqual([]);
  });

  it('строки вида: без сценария коэффициент равен 1, со сценарием — отношение к базе', () => {
    const base = aggregate(manual, 'day', { from: 7, to: 8 }, true);
    expect(viewRows(base).map((row) => [row.route, row.base, row.coefficient, row.prediction])).toEqual([
      [1, 2, 1, 2], [1, 2, 1, 2], [17, 4, 1, 4], [17, 4, 1, 4],
    ]);
    const adjusted = base.map((row) => ({ ...row, prediction: row.prediction * 1.5 }));
    expect(viewRows(base, adjusted).map((row) => [row.coefficient, row.prediction])).toEqual([
      [1.5, 3], [1.5, 3], [1.5, 6], [1.5, 6],
    ]);
    expect(viewRows([{ key: '2025-11-02', route: null, prediction: 0 }])[0]).toEqual(
      { key: '2025-11-02', route: null, base: 0, coefficient: 1, prediction: 0 },
    );
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
