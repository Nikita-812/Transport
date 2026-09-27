// Календарная арифметика над датами `YYYY-MM-DD` в UTC-полночь, без локального пояса браузера (design D5).
// Раздел 2 дополняет модуль горизонтами и московским «сейчас».
import type { IsoDate } from '../api/types';

const DAY_MS = 86_400_000;

/** Миллисекунды UTC-полуночи даты. Не использует `new Date('YYYY-MM-DD')` в локальном поясе. */
export function isoToUtcMs(date: IsoDate): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

/** Число дней в включительном диапазоне `start…end`; 0, если диапазон пуст. */
export function daysInclusive(start: IsoDate, end: IsoDate): number {
  return Math.max(0, Math.round((isoToUtcMs(end) - isoToUtcMs(start)) / DAY_MS) + 1);
}
