import type { IsoDate, RouteId, Season } from '../api/types';
import type { HourRange } from './aggregate';
import { addDays, season as seasonOf } from './dates';
import type { RouteSeries } from './series';

export const WEATHER_PRESETS = [
  { id: 'clear', name: 'Ясно', multiplier: 1 },
  { id: 'rain', name: 'Дождь', multiplier: 0.95 },
  { id: 'snow', name: 'Снегопад', multiplier: 0.92 },
  { id: 'frost', name: 'Сильный мороз (ниже −20 °C)', multiplier: 0.9 },
  { id: 'heat', name: 'Жара (выше +30 °C)', multiplier: 0.95 },
] as const;

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
      id: 'weather', kind: 'weather', name: WEATHER_PRESETS[0].name, multiplier: WEATHER_PRESETS[0].multiplier,
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
