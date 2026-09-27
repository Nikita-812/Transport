import { afterEach, describe, expect, it, vi } from 'vitest';
import { addDays, isoWeek, moscowNow, season, weekday } from './dates';
import { defaultGranularity, horizonEnd, nowSelection, resolveRange } from './horizon';

afterEach(() => vi.useRealTimers());
const coverage = { start: '2025-11-01', end: '2026-10-31' };

describe('календарь независимо от часового пояса машины', () => {
  it('тесты действительно запущены в UTC+7', () => {
    expect(new Date('2026-01-01T00:00:00Z').getTimezoneOffset()).toBe(-420);
  });
  it.each([
    ['2026-01-31', 'month', '2026-02-27'], ['2024-01-31', 'month', '2024-02-28'],
    ['2025-12-31', 'month', '2026-01-30'], ['2025-11-01', 'year', '2026-10-31'],
    ['2024-02-29', 'year', '2025-02-27'], ['2026-01-31', 'day', '2026-01-31'],
  ] as const)('%s, %s → %s', (start, horizon, end) => expect(horizonEnd(start, horizon)).toBe(end));
  it('обрезает год двухмесячным покрытием', () => {
    expect(resolveRange('year', coverage.start, coverage.start, { ...coverage, end: '2025-12-31' }))
      .toEqual({ start: '2025-11-01', end: '2025-12-31', clipped: true });
    expect(resolveRange('year', coverage.start, coverage.start, coverage).clipped).toBe(false);
  });
  it('день и час по Москве при 01:30 в Новосибирске', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T01:30:00+07:00'));
    expect(moscowNow()).toEqual({ date: '2026-01-01', hour: 21 });
    expect(nowSelection(coverage)).toEqual({ date: '2026-01-01', hour: 21, outsideCoverage: false });
    vi.setSystemTime(new Date('2027-01-02T01:30:00+07:00'));
    expect(nowSelection(coverage)).toEqual({ date: coverage.start, hour: 21, outsideCoverage: true });
  });
  it('московская полночь — 0, не 24', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-01T21:00:00Z'));
    expect(moscowNow()).toEqual({ date: '2026-01-02', hour: 0 });
  });
  it('UTC-сдвиг, ISO-неделя через границу года, понедельник и сезоны', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(isoWeek('2025-11-03')).toBe('2025-W45');
    expect(isoWeek('2025-12-29')).toBe('2026-W01');
    expect(isoWeek('2021-01-01')).toBe('2020-W53');
    expect(weekday('2025-11-03')).toBe(0);
    expect(['01', '03', '06', '09', '12'].map((month) => season(`2026-${month}-01`)))
      .toEqual(['winter', 'spring', 'summer', 'autumn', 'winter']);
  });
  it('детализация от горизонта и длины периода', () => {
    expect(defaultGranularity('day', coverage)).toBe('hour');
    expect(defaultGranularity('month', coverage)).toBe('day');
    expect(defaultGranularity('year', coverage)).toBe('week');
    for (const [days, expected] of [[1, 'hour'], [2, 'hour'], [3, 'day'], [92, 'day'], [93, 'week']] as const) {
      expect(defaultGranularity('period', { start: coverage.start, end: addDays(coverage.start, days - 1) })).toBe(expected);
    }
  });
});
