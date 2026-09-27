import { describe, expect, it } from 'vitest';
import type { RouteSeries } from './series';
import {
  applyScenario, createDefaultScenario, DEFAULT_WEATHER_PRESET, WEATHER_PRESETS, type ScenarioRule,
} from './scenario';

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

describe('погодные пресеты', () => {
  function preset(id: string) {
    const found = WEATHER_PRESETS.find((item) => item.id === id);
    if (!found) throw new Error(`в списке нет пресета ${id}`);
    return found;
  }

  it('пять пресетов в порядке от базы, первый — значение по умолчанию', () => {
    expect(WEATHER_PRESETS.map((item) => item.id)).toEqual(['clear', 'rain', 'snow', 'frost', 'heat']);
    expect(WEATHER_PRESETS[0]).toBe(DEFAULT_WEATHER_PRESET);
  });

  it('Ясно — база 1,00: часы без осадков, к которым нормированы остальные', () => {
    expect(preset('clear')).toEqual({
      id: 'clear', name: 'Ясно', multiplier: 1, basis: 'base',
      note: 'база измерения: часы без осадков',
    });
  });

  it('Дождь — 0,93 по измерению 2025 года с интервалом 0,90–0,97', () => {
    expect(preset('rain')).toEqual({
      id: 'rain', name: 'Дождь (более 0,2 мм/ч)', multiplier: 0.93, basis: 'measured',
      note: 'измерено по данным 2025 г. (Open-Meteo), 95% ДИ 0,90–0,97',
    });
  });

  it('Жара — 0,98, но интервал накрывает 1, поэтому эффект не подтверждён', () => {
    expect(preset('heat')).toEqual({
      id: 'heat', name: 'Жара (выше +25 °C)', multiplier: 0.98, basis: 'unconfirmed',
      note: 'эффект статистически не подтверждён',
    });
  });

  it('Снегопад 0,92 и мороз 0,90 остались экспертными: зимы в срезах нет', () => {
    const expected = [['snow', 0.92], ['frost', 0.9]] as const;
    for (const [id, multiplier] of expected) {
      expect(preset(id).multiplier).toBe(multiplier);
      expect(preset(id).basis).toBe('expert');
      expect(preset(id).note).toBe('экспертное допущение: зимних дней в проверочных срезах нет');
    }
  });

  it('каждый множитель кратен шагу полей «Сценария» 0,01 и лежит в диапазоне 0–3', () => {
    for (const item of WEATHER_PRESETS) {
      expect(item.multiplier * 100).toBeCloseTo(Math.round(item.multiplier * 100), 9);
      expect(item.multiplier).toBeGreaterThanOrEqual(0);
      expect(item.multiplier).toBeLessThanOrEqual(3);
      expect(item.note.length).toBeGreaterThan(0);
    }
  });

  it('по умолчанию сценарий стоит на «Ясно», то есть ничего не меняет', () => {
    const weather = createDefaultScenario().find((item) => item.kind === 'weather');
    expect(weather?.name).toBe(DEFAULT_WEATHER_PRESET.name);
    expect(weather?.multiplier).toBe(1);
  });
});

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
