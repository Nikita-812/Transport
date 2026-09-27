import { describe, expect, it } from 'vitest';
import {
  isConfirmed, measuredEffect, presetMultiplier, WEATHER_EFFECTS, type WeatherCategory,
} from './weather-effects';

describe('копия weather_effects.json', () => {
  it('источник, модель и протокол бутстрепа — те, на которых измерен эффект', () => {
    expect(WEATHER_EFFECTS.source_url).toBe('https://open-meteo.com/en/docs/historical-weather-api');
    expect(WEATHER_EFFECTS.period.start).toBe('2025-05-01');
    expect(WEATHER_EFFECTS.period.end).toBe('2025-10-31');
    expect(WEATHER_EFFECTS.model).toBe('pooled_route_blend');
    expect(WEATHER_EFFECTS.bootstrap).toMatchObject({ iterations: 10_000, confidence: 0.95, seed: 42 });
  });

  it('три среза май–октябрь обучены только на прошлом', () => {
    const slices = WEATHER_EFFECTS.period.slices;
    expect(slices.map((slice) => slice.name)).toEqual(['may-june', 'july-august', 'september-october']);
    for (const slice of slices) {
      expect(slice.train_through < slice.start).toBe(true);
      expect(slice.start <= slice.end).toBe(true);
    }
  });

  it('у каждой категории интервал накрывает множитель, а без часов множителя нет', () => {
    for (const effect of WEATHER_EFFECTS.effects) {
      expect(effect.hours).toBeGreaterThanOrEqual(0);
      expect(effect.label_ru.length).toBeGreaterThan(0);
      if (effect.multiplier === null) {
        expect(effect.hours).toBe(0);
        expect(effect.enough_data).toBe(false);
        continue;
      }
      expect(effect.ci_low).toBeLessThanOrEqual(effect.multiplier);
      expect(effect.ci_high).toBeGreaterThanOrEqual(effect.multiplier);
    }
  });
});

describe('какие категории считаются измеренными', () => {
  it('дождь и жара — да, снегопад и морозы — нет', () => {
    expect(measuredEffect('rain')?.multiplier).toBeCloseTo(0.931495, 6);
    expect(measuredEffect('heat_above_25')?.multiplier).toBeCloseTo(0.979875, 6);
    for (const category of ['snowfall', 'frost_below_minus_10', 'frost_below_minus_20'] satisfies WeatherCategory[]) {
      expect(measuredEffect(category)).toBeNull();
    }
  });

  it('снегопад отброшен по enough_data, хотя множитель в файле есть: 11 часов', () => {
    const snow = WEATHER_EFFECTS.effects.find((effect) => effect.category === 'snowfall');
    expect(snow?.hours).toBe(11);
    expect(snow?.multiplier).not.toBeNull();
    expect(snow?.enough_data).toBe(false);
  });

  it('морозных часов в срезах не было вовсе', () => {
    const frost = WEATHER_EFFECTS.effects.filter((effect) => effect.category.startsWith('frost_'));
    expect(frost).toHaveLength(2);
    for (const effect of frost) {
      expect(effect.hours).toBe(0);
      expect(effect.multiplier).toBeNull();
    }
  });
});

describe('подтверждение эффекта интервалом', () => {
  it('дождь подтверждён: 0,896–0,967 не накрывает 1', () => {
    const rain = measuredEffect('rain');
    expect(rain).not.toBeNull();
    expect(isConfirmed(rain!)).toBe(true);
  });

  it('жара не подтверждена: 0,959–1,004 накрывает 1', () => {
    const heat = measuredEffect('heat_above_25');
    expect(heat?.ci_high).toBeGreaterThan(1);
    expect(isConfirmed(heat!)).toBe(false);
  });

  it('база не подтверждается сама собой: интервал 1–1 накрывает 1', () => {
    const base = measuredEffect('no_precipitation');
    expect(base?.multiplier).toBe(1);
    expect(isConfirmed(base!)).toBe(false);
  });
});

describe('множитель под шаг пресета', () => {
  it('округляет до 0,01: 0,931495 → 0,93 и 0,979875 → 0,98', () => {
    expect(presetMultiplier(measuredEffect('rain')!)).toBe(0.93);
    expect(presetMultiplier(measuredEffect('heat_above_25')!)).toBe(0.98);
    expect(presetMultiplier(measuredEffect('no_precipitation')!)).toBe(1);
  });
});
