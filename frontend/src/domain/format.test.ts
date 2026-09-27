import { describe, expect, it } from 'vitest';
import { daysInclusive, isoToUtcMs } from './dates';
import {
  formatBucketLabel, formatBucketTitle, formatCompact, formatDays, formatDecimal, formatInteger,
  formatIsoDate, formatWeekdayLong, formatWeekdayShort, pluralRu,
} from './format';

const NBSP = ' ';

describe('format', () => {
  it('целые ru-RU с разрядами', () => {
    expect(formatInteger(1234567.6)).toBe(`1${NBSP}234${NBSP}568`);
    expect(formatInteger(0)).toBe('0');
  });

  it('дробные с запятой', () => {
    expect(formatDecimal(0.861, 3)).toBe('0,861');
    expect(formatDecimal(1.2, 2)).toBe('1,20');
  });

  it('даты без часовых поясов', () => {
    expect(formatIsoDate('2025-11-01')).toBe('01.11.2025');
  });

  it('склонение', () => {
    const forms = ['день', 'дня', 'дней'] as const;
    expect([1, 2, 5, 11, 12, 21, 22, 25, 61, 111, 365].map((n) => pluralRu(n, forms))).toEqual([
      'день', 'дня', 'дней', 'дней', 'дней', 'день', 'дня', 'дней', 'день', 'дней', 'дней',
    ]);
    expect(formatDays(61)).toBe('61 день');
  });

  it('компактные подписи оси', () => {
    expect(formatCompact(70927230)).toBe(`70,9${NBSP}млн`);
    expect(formatCompact(12480)).toBe(`12${NBSP}тыс.`);
    expect(formatCompact(1200)).toBe(`1${NBSP}200`);
    expect(formatCompact(0)).toBe('0');
  });

  it('подписи корзин: полная и короткая', () => {
    expect(formatBucketTitle('2025-11-01T08:00', 'hour')).toBe('01.11.2025 08:00');
    expect(formatBucketLabel('2025-11-01T08:00', 'hour')).toBe('01.11 08:00');
    expect(formatBucketTitle('2025-11-01', 'day')).toBe('01.11.2025');
    expect(formatBucketLabel('2025-11-01', 'day')).toBe('01.11');
    expect(formatBucketTitle('2025-W45', 'week')).toBe('45-я неделя 2025');
    expect(formatBucketLabel('2025-W45', 'week')).toBe('W45 25');
    expect(formatBucketTitle('2026-01', 'month')).toBe('январь 2026');
    expect(formatBucketLabel('2026-01', 'month')).toBe('янв. 2026');
    expect(formatBucketTitle('08:00', 'hourOfDay')).toBe('08:00');
    expect(formatBucketTitle('0', 'weekday')).toBe('Понедельник');
    expect(formatBucketTitle('winter', 'season')).toBe('Зима');
  });

  it('дни недели: понедельник — ноль', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(formatWeekdayShort)).toEqual(['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']);
    expect(formatWeekdayLong(6)).toBe('Воскресенье');
  });
});

describe('dates', () => {
  it('дни включительно', () => {
    expect(daysInclusive('2025-11-01', '2025-12-31')).toBe(61);
    expect(daysInclusive('2025-11-01', '2026-10-31')).toBe(365);
    expect(daysInclusive('2025-11-01', '2025-11-01')).toBe(1);
    expect(daysInclusive('2025-11-02', '2025-11-01')).toBe(0);
  });

  it('UTC-полночь', () => {
    expect(new Date(isoToUtcMs('2026-03-29')).toISOString()).toBe('2026-03-29T00:00:00.000Z');
  });
});
