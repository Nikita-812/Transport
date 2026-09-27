import type { IsoDate, RouteId, Season } from '../api/types';
import {
  isConfirmed, measuredEffect, presetMultiplier, WEATHER_EFFECTS, type MeasuredEffect,
} from '../data/weather-effects';
import type { HourRange } from './aggregate';
import { addDays, season as seasonOf } from './dates';
import { formatDecimal } from './format';
import type { RouteSeries } from './series';

/** На чём держится множитель пресета погоды. */
export type WeatherBasis = 'base' | 'measured' | 'unconfirmed' | 'expert';

export interface WeatherPreset {
  id: string;
  name: string;
  multiplier: number;
  basis: WeatherBasis;
  /** Подпись под выбором погоды. */
  note: string;
}

const MEASURED_YEAR = WEATHER_EFFECTS.period.start.slice(0, 4);
const NO_WINTER_NOTE = 'экспертное допущение: зимних дней в проверочных срезах нет';

/**
 * Пресет по измерению из `weather-effects.json`, а если его нет — по прежнему экспертному
 * значению. Множитель и границы интервала округлены до шага полей «Сценария» — 0,01.
 */
function weatherPreset(id: string, name: string, effect: MeasuredEffect | null, expert: number): WeatherPreset {
  if (!effect) return { id, name, multiplier: expert, basis: 'expert', note: NO_WINTER_NOTE };
  if (!isConfirmed(effect)) {
    return {
      id, name, multiplier: presetMultiplier(effect), basis: 'unconfirmed',
      note: 'эффект статистически не подтверждён',
    };
  }
  return {
    id, name, multiplier: presetMultiplier(effect), basis: 'measured',
    note: `измерено по данным ${MEASURED_YEAR}\u00a0г. (Open-Meteo), 95% ДИ `
      + `${formatDecimal(effect.ci_low, 2)}–${formatDecimal(effect.ci_high, 2)}`,
  };
}

/** База измерения и значение по умолчанию: часы без осадков, к которым нормированы остальные. */
export const DEFAULT_WEATHER_PRESET: WeatherPreset = {
  id: 'clear', name: 'Ясно', multiplier: 1, basis: 'base',
  note: 'база измерения: часы без осадков',
};

/**
 * Дождь и жара измерены на вневыборочных срезах май–октябрь 2025 года. У снегопада в них 11 часов, у
 * мороза — ни одного, поэтому `enough_data` у них ложно и пресеты остаются прежними экспертными
 * значениями. Пороги в названиях — те же, что у категорий измерения.
 */
export const WEATHER_PRESETS: readonly WeatherPreset[] = [
  DEFAULT_WEATHER_PRESET,
  weatherPreset('rain', 'Дождь (более 0,2 мм/ч)', measuredEffect('rain'), 0.95),
  weatherPreset('snow', 'Снегопад', measuredEffect('snowfall'), 0.92),
  weatherPreset('frost', 'Сильный мороз (ниже −20 °C)', measuredEffect('frost_below_minus_20'), 0.9),
  weatherPreset('heat', 'Жара (выше +25 °C)', measuredEffect('heat_above_25'), 0.95),
];

export const EVENT_PRESETS = [
  { id: 'match-concert', name: 'Матч или концерт', multiplier: 1.3 },
  { id: 'city-holiday', name: 'Городской праздник', multiplier: 1.2 },
  { id: 'closure', name: 'Ремонт или перекрытие', multiplier: 0.5 },
] as const;

export type ScenarioKind = 'weather' | 'season' | 'event';

export interface ScenarioRule {
  id: string;
  kind: ScenarioKind;
  name: string;
  multiplier: number;
  routes: 'all' | RouteId[];
  dates: null | { from: IsoDate; to: IsoDate };
  hours: null | HourRange;
  season?: Season;
  enabled: boolean;
}

/** В D0 сценарий фиксирован: одна поправка каждого вида, без хранения между перезагрузками. */
export function createDefaultScenario(): ScenarioRule[] {
  return [
    {
      id: 'weather', kind: 'weather', name: DEFAULT_WEATHER_PRESET.name, multiplier: DEFAULT_WEATHER_PRESET.multiplier,
      routes: 'all', dates: null, hours: null, enabled: true,
    },
    {
      id: 'season', kind: 'season', name: 'Сезонная поправка', multiplier: 1,
      routes: 'all', dates: null, hours: null, season: 'winter', enabled: false,
    },
    {
      id: 'event', kind: 'event', name: EVENT_PRESETS[0].name, multiplier: EVENT_PRESETS[0].multiplier,
      routes: 'all', dates: null, hours: { from: 0, to: 23 }, enabled: false,
    },
  ];
}

export interface ScenarioRouteSeries extends RouteSeries {
  /** Итоговый коэффициент каждой ячейки `dayIndex × 24 + hour`. */
  coefficients: Float64Array;
}

function matches(rule: ScenarioRule, route: RouteId, date: IsoDate, hour: number): boolean {
  if (!rule.enabled) return false;
  if (rule.routes !== 'all' && !rule.routes.includes(route)) return false;
  if (rule.dates && (date < rule.dates.from || date > rule.dates.to)) return false;
  if (rule.hours && (hour < rule.hours.from || hour > rule.hours.to)) return false;
  if (rule.kind === 'season' && rule.season !== seasonOf(date)) return false;
  return true;
}

function clampCoefficient(value: number): number {
  return Math.min(3, Math.max(0, value));
}

/**
 * Единственная точка применения сценария. Базовые `Float64Array` не меняются: результат содержит
 * скорректированные значения и коэффициент для каждого часа, чтобы карта и выпуск могли читать его
 * через тот же хук без повторной реализации правил.
 */
export function applyScenario(series: readonly RouteSeries[], rules: readonly ScenarioRule[]): ScenarioRouteSeries[] {
  return series.map((item) => {
    const values = new Float64Array(item.values.length);
    const coefficients = new Float64Array(item.values.length);
    for (let day = 0; day < item.days; day++) {
      const date = addDays(item.start, day);
      for (let hour = 0; hour < 24; hour++) {
        const index = day * 24 + hour;
        let coefficient = 1;
        for (const rule of rules) {
          if (matches(rule, item.route, date, hour)) coefficient *= rule.multiplier;
        }
        coefficient = clampCoefficient(coefficient);
        coefficients[index] = coefficient;
        values[index] = item.values[index]! * coefficient;
      }
    }
    return { ...item, values, coefficients };
  });
}

export function hasActiveScenario(rules: readonly ScenarioRule[]): boolean {
  return rules.some((rule) => rule.enabled && rule.multiplier !== 1);
}
