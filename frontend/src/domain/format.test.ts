import { describe, expect, it } from 'vitest';
import { daysInclusive, isoToUtcMs } from './dates';
import { formatDays, formatDecimal, formatInteger, formatIsoDate, pluralRu } from './format';

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
