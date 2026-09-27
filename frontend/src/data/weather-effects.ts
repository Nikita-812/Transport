// Измеренное влияние погоды на посадки. `weather-effects.json` — побайтовая копия `weather_effects.json`
// из ветки feat/model-calendar-weather (коммит c7d5ca4); пересчитывает его `python3 -m weather_effects`
// в той ветке, здесь файл только читается. Модель на погоде не обучена: это отдельное измерение на её
// вневыборочных прогнозах, и интерфейс берёт из него значения погодных пресетов «Сценария».
import type { IsoDate } from '../api/types';
import raw from './weather-effects.json';

export type WeatherCategory =
  | 'no_precipitation' | 'rain' | 'snowfall'
  | 'frost_below_minus_10' | 'frost_below_minus_20' | 'heat_above_25';

export interface WeatherEffect {
  category: WeatherCategory;
  label_ru: string;
  /** Отношение посадок к часам без осадков; `null`, если часов категории в срезах не было. */
  multiplier: number | null;
  ci_low: number | null;
  ci_high: number | null;
  /** Часов категории в проверочных срезах. */
  hours: number;
  /** Часов хватило для оценки: иначе множитель показывать нельзя. */
  enough_data: boolean;
}

/** Измерение с числовым множителем и интервалом: `enough_data` и `null` уже проверены. */
export interface MeasuredEffect extends WeatherEffect {
  multiplier: number;
  ci_low: number;
  ci_high: number;
}

export interface WeatherSlice {
  name: string;
  /** Срез обучен только на прошлом: данные по эту дату включительно. */
  train_through: IsoDate;
  start: IsoDate;
  end: IsoDate;
}

export interface WeatherEffectsData {
  source_url: string;
  period: { start: IsoDate; end: IsoDate; slices: WeatherSlice[] };
  /** Модель, на вневыборочных прогнозах которой измерен эффект. */
  model: string;
  method: string;
  bootstrap: { unit: string; iterations: number; confidence: number; seed: number };
  effects: WeatherEffect[];
}

/** Форму файла проверяет `weather-effects.test.ts`, поэтому здесь достаточно приведения типа. */
export const WEATHER_EFFECTS = raw as unknown as WeatherEffectsData;

/** Измерение категории или `null`, если данных не хватило: тогда пресет остаётся экспертным. */
export function measuredEffect(category: WeatherCategory): MeasuredEffect | null {
  const effect = WEATHER_EFFECTS.effects.find((item) => item.category === category);
  if (!effect || !effect.enough_data) return null;
  const { multiplier, ci_low, ci_high } = effect;
  if (multiplier === null || ci_low === null || ci_high === null) return null;
  return { ...effect, multiplier, ci_low, ci_high };
}

/**
 * Эффект подтверждён, если 95%-й интервал не накрывает 1. У жары интервал включает 1, поэтому её
 * множитель показывается с оговоркой, а не как измеренный факт.
 */
export function isConfirmed(effect: MeasuredEffect): boolean {
  return effect.ci_low > 1 || effect.ci_high < 1;
}

/** Множитель под шаг пресетов и полей «Сценария» — 0,01. */
export function presetMultiplier(effect: MeasuredEffect): number {
  return Math.round(effect.multiplier * 100) / 100;
}
