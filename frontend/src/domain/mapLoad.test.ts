import { describe, expect, it } from 'vitest';
import { parseRawForecast, type RouteId } from '../api/types';
import fixture from '../test/fixtures/forecast-real.json';
import { profile } from './aggregate';
import {
  clampHour, formatLoadRange, legendRanges, lineWidth, loadClass, loadScale, nextPlaybackHour, routeHourLoads, stopHourProfile, MAX_LINE_WIDTH, MIN_LINE_WIDTH,
} from './mapLoad';
import { applyScenario, createDefaultScenario, type ScenarioRule } from './scenario';
import { normalizeSeries, type RouteSeries } from './series';

/** Настоящий прогноз снимка D3 за один день или период фикстуры (01–07.11.2025). */
function realSeries(start: string, end: string): RouteSeries[] {
  return fixture.raw.map(parseRawForecast).map((response) => {
    const route = response.routes[0]!;
    return normalizeSeries(route, start, end, response.rows.filter((row) => row.date >= start && row.date <= end));
  });
}

const constant = (route: RouteId, days: number, fill: (day: number, hour: number) => number): RouteSeries => ({
  route, start: '2025-11-03', days, values: Float64Array.from({ length: days * 24 }, (_, index) => fill(Math.floor(index / 24), index % 24)),
});

describe('значения «маршрут × час» на карте', () => {
  it('на многодневном периоде — среднее за день, вне диапазона часов — null', () => {
    const [load] = routeHourLoads([constant(17, 2, (day, hour) => (day === 0 ? hour : 3 * hour))], { from: 7, to: 10 });
    expect(load!.route).toBe(17);
    expect(load!.values.slice(7, 11)).toEqual([14, 16, 18, 20]);
    expect(load!.values[6]).toBeNull();
    expect(load!.values[11]).toBeNull();
  });

  it('на горизонте «День» — прогноз этой даты и часа', () => {
    const day = realSeries('2025-11-05', '2025-11-05');
    const loads = routeHourLoads(day, { from: 0, to: 23 });
    expect(loads[1]!.values[8]).toBe(day[1]!.values[8]);
  });
});

describe('классы нагрузки', () => {
  const ramp = [{ route: 1 as RouteId, values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }];

  it('4 границы квантилей 20/40/60/80 % и 5 классов', () => {
    const scale = loadScale(ramp)!;
    expect(scale.breaks.map((edge) => Number(edge.toFixed(6)))).toEqual([2.8, 4.6, 6.4, 8.2]);
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => loadClass(value, scale))).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
    expect(legendRanges(scale)).toEqual([
      { from: 1, to: scale.breaks[0] }, { from: scale.breaks[0], to: scale.breaks[1] }, { from: scale.breaks[1], to: scale.breaks[2] },
      { from: scale.breaks[2], to: scale.breaks[3] }, { from: scale.breaks[3], to: 10 },
    ]);
  });

  it('подпись класса: границы в посадках в час, совпадающие — одним числом', () => {
    expect(formatLoadRange({ from: 322.4, to: 1129.2 })).toBe('322 – 1 129');
    expect(formatLoadRange({ from: 0, to: 0.3 })).toBe('0');
  });

  it('без значений шкалы нет; одинаковые значения — нижний класс', () => {
    expect(loadScale([{ route: 1, values: [null, null] }])).toBeNull();
    const flat = loadScale([{ route: 1, values: [5, 5, 5] }])!;
    expect(loadClass(5, flat)).toBe(0);
  });

  it('толщина 2–10 px пропорциональна √значения', () => {
    const scale = loadScale([{ route: 1, values: [0, 400] }])!;
    expect(lineWidth(400, scale)).toBe(MAX_LINE_WIDTH);
    expect(lineWidth(100, scale)).toBe(5);
    expect(lineWidth(0, scale)).toBe(MIN_LINE_WIDTH);
  });

  it('будний день: в 08:00 классы выше, чем в 03:00 (настоящий прогноз 05.11.2025)', () => {
    const loads = routeHourLoads(realSeries('2025-11-05', '2025-11-05'), { from: 0, to: 23 });
    const scale = loadScale(loads)!;
    for (const load of loads) {
      expect(loadClass(load.values[8]!, scale)).toBeGreaterThan(loadClass(load.values[3]!, scale));
      expect(lineWidth(load.values[8]!, scale)).toBeGreaterThan(lineWidth(load.values[3]!, scale));
    }
  });

  it('шкала строится по значениям после сценария — тем же, что на карте', () => {
    const base = realSeries('2025-11-05', '2025-11-05');
    const rules = createDefaultScenario().map((rule): ScenarioRule => (rule.kind === 'event'
      ? { ...rule, enabled: true, multiplier: 1.3, routes: [17], hours: { from: 18, to: 23 } }
      : rule));
    const adjusted = applyScenario(base, rules);
    const scale = loadScale(routeHourLoads(adjusted, { from: 0, to: 23 }))!;
    const shown = adjusted.flatMap((item) => [...item.values]);
    expect(scale.max).toBe(Math.max(...shown));
    expect(scale.min).toBe(Math.min(...shown));
  });
});

describe('час карты', () => {
  it('проигрывание идёт по кругу внутри диапазона часов', () => {
    expect(nextPlaybackHour(22, { from: 0, to: 23 })).toBe(23);
    expect(nextPlaybackHour(23, { from: 0, to: 23 })).toBe(0);
    expect(nextPlaybackHour(10, { from: 7, to: 10 })).toBe(7);
    expect(nextPlaybackHour(3, { from: 7, to: 10 })).toBe(8);
    expect(clampHour(3, { from: 7, to: 10 })).toBe(7);
    expect(clampHour(12, { from: 7, to: 10 })).toBe(10);
  });
});

describe('остановка: сумма прогнозов маршрутов', () => {
  it('сумма маршрутов остановки по часам, итог и пик', () => {
    const week = realSeries('2025-11-01', '2025-11-07');
    const result = stopHourProfile(week, [1, 17], { from: 0, to: 23 });
    const expected = profile(week, 'hourOfDay');
    expect(result.hours).toEqual(Array.from({ length: 24 }, (_, hour) => hour));
    result.values.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!.prediction, 9));
    expect(result.total).toBeCloseTo(expected.reduce((sum, row) => sum + row.prediction, 0), 9);
    const max = Math.max(...result.values);
    expect(result.peak).toEqual({ hour: result.values.indexOf(max), value: max });
  });

  it('учитывает только маршруты остановки и диапазон часов', () => {
    const day = realSeries('2025-11-05', '2025-11-05');
    const only17 = stopHourProfile(day, [17, 50], { from: 7, to: 10 });
    expect(only17.hours).toEqual([7, 8, 9, 10]);
    expect(only17.values).toEqual([7, 8, 9, 10].map((hour) => day[1]!.values[hour]!));
    expect(stopHourProfile(day, [50], { from: 0, to: 23 })).toEqual({ hours: [], values: [], total: 0, peak: null });
  });
});
