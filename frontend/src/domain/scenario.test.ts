import { describe, expect, it } from 'vitest';
import type { RouteSeries } from './series';
import { applyScenario, createDefaultScenario, type ScenarioRule } from './scenario';

function constant(route: 1 | 17, start: string, days: number, value = 100): RouteSeries {
  return { route, start, days, values: new Float64Array(days * 24).fill(value) };
}

function rule(partial: Partial<ScenarioRule> & Pick<ScenarioRule, 'kind' | 'multiplier'>): ScenarioRule {
  return {
    id: partial.kind,
    name: partial.kind,
    routes: 'all',
    dates: null,
    hours: null,
    enabled: true,
    ...partial,
  };
}

describe('сценарные коэффициенты', () => {
  it('перемножает снегопад 0,92 и событие 1,30 без изменения базы', () => {
    const base = constant(17, '2025-11-03', 1);
    const result = applyScenario([base], [
      rule({ kind: 'weather', multiplier: 0.92 }),
      rule({ kind: 'event', multiplier: 1.3 }),
    ])[0]!;
    expect(result.coefficients[18]).toBeCloseTo(1.196, 12);
    expect(result.values[18]).toBeCloseTo(119.6, 12);
    expect(base.values[18]).toBe(100);
  });

  it('событие для маршрута 17 в 18–23 не меняет другие маршруты и часы', () => {
    const result = applyScenario([constant(1, '2025-11-03', 1), constant(17, '2025-11-03', 1)], [
      rule({ kind: 'event', multiplier: 1.3, routes: [17], hours: { from: 18, to: 23 } }),
    ]);
    expect([...result[0]!.coefficients]).toEqual(Array<number>(24).fill(1));
    expect(result[1]!.coefficients[17]).toBe(1);
    expect([...result[1]!.coefficients.slice(18)]).toEqual(Array<number>(6).fill(1.3));
  });

  it('сезоны: декабрь–февраль, март–май, июнь–август, сентябрь–ноябрь', () => {
    const starts = ['2025-12-01', '2026-03-01', '2026-06-01', '2026-09-01'] as const;
    const seasons = ['winter', 'spring', 'summer', 'autumn'] as const;
    seasons.forEach((season, index) => {
      const result = applyScenario([constant(17, starts[index]!, 1)], [
        rule({ kind: 'season', multiplier: 1.25, season }),
      ])[0]!;
      expect(result.coefficients[0]).toBe(1.25);
    });
    const winterAcrossYear = applyScenario([constant(17, '2026-02-28', 2)], [
      rule({ kind: 'season', multiplier: 1.25, season: 'winter' }),
    ])[0]!;
    expect(winterAcrossYear.coefficients[0]).toBe(1.25);
    expect(winterAcrossYear.coefficients[24]).toBe(1);
  });

  it('учитывает включительный диапазон дат и ограничивает произведение диапазоном 0–3', () => {
    const result = applyScenario([constant(17, '2025-11-03', 3)], [
      rule({ kind: 'weather', multiplier: 2 }),
      rule({ kind: 'event', multiplier: 2, dates: { from: '2025-11-04', to: '2025-11-04' } }),
    ])[0]!;
    expect(result.coefficients[0]).toBe(2);
    expect(result.coefficients[24]).toBe(3);
    expect(result.coefficients[48]).toBe(2);
  });

  it('сброшенный сценарий оставляет коэффициенты равными 1', () => {
    const result = applyScenario([constant(17, '2025-11-03', 1)], createDefaultScenario())[0]!;
    expect([...result.coefficients]).toEqual(Array<number>(24).fill(1));
    expect([...result.values]).toEqual(Array<number>(24).fill(100));
  });
});
