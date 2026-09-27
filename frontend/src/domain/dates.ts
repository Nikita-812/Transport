// Календарная арифметика над датами `YYYY-MM-DD` в UTC-полночь, без локального пояса браузера (design D5).
import type { IsoDate, Season } from '../api/types';

export const DAY_MS = 86_400_000;

/** Миллисекунды UTC-полуночи даты. Не использует `new Date('YYYY-MM-DD')` в локальном поясе. */
export function isoToUtcMs(date: IsoDate): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

/** Число дней в включительном диапазоне `start…end`; 0, если диапазон пуст. */
export function daysInclusive(start: IsoDate, end: IsoDate): number {
  return Math.max(0, Math.round((isoToUtcMs(end) - isoToUtcMs(start)) / DAY_MS) + 1);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return new Date(isoToUtcMs(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Сдвиг с ограничением числа длиной целевого месяца, как в forecast_export.horizon_end. */
export function addMonthsClamped(date: IsoDate, months: number): IsoDate {
  const source = new Date(isoToUtcMs(date));
  const target = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(source.getUTCDate(), lastDay));
  return target.toISOString().slice(0, 10);
}

export function weekday(date: IsoDate): number {
  return (new Date(isoToUtcMs(date)).getUTCDay() + 6) % 7;
}

export function isoWeek(date: IsoDate): string {
  const thursday = addDays(date, 3 - weekday(date));
  const year = thursday.slice(0, 4);
  const week = Math.ceil(daysInclusive(`${year}-01-01`, thursday) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export function season(date: IsoDate): Season {
  const month = Number(date.slice(5, 7));
  if (month === 12 || month <= 2) return 'winter';
  if (month <= 5) return 'spring';
  if (month <= 8) return 'summer';
  return 'autumn';
}

const moscowFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', hourCycle: 'h23',
});

export function moscowNow(now: Date = new Date()): { date: IsoDate; hour: number } {
  const parts = Object.fromEntries(moscowFormatter.formatToParts(now).map(({ type, value }) => [type, value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}
