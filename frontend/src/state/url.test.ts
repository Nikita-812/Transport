import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseUrl, serializeUrl } from './url';
import { useUiStore } from './store';

const coverage = { start: '2025-11-01', end: '2026-10-31' };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-02T01:30:00+07:00')); });
afterEach(() => vi.useRealTimers());
describe('разбор → валидация покрытия → стор', () => {
  it('восстанавливает вид и сериализует пустой выбор без подмены всеми маршрутами', () => {
    const parsed = parseUrl('?routes=1,17&h=month&start=2025-11-01&end=2025-11-30&hours=7-10&g=day&tab=map&split=total', coverage);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.filters.routes).toEqual([1, 17]);
    expect(parsed.filters.hours).toEqual({ from: 7, to: 10 });
    expect(parseUrl(serializeUrl(parsed.filters, parsed.tab), coverage)).toEqual(parsed);
    const empty = parseUrl('?routes=', coverage);
    expect(parseUrl(serializeUrl(empty.filters, 'overview'), coverage).filters.routes).toEqual([]);
  });
  it('игнорирует неверные параметры с уведомлением, корректные сохраняет', () => {
    const { filters, warnings, tab } = parseUrl('?routes=1,999&h=bad&start=2026-02-30&end=no&hours=23-7&g=raw&tab=no&split=bad&unknown=42', coverage);
    expect(warnings).toHaveLength(9);
    expect(filters.start).toBe('2026-01-01');
    expect(filters.hours).toEqual({ from: 0, to: 23 });
    expect(tab).toBe('overview');
    expect(parseUrl('?routes=17&routes=1&hours=7.5-10', coverage).warnings).toHaveLength(2);
  });
  it('даты вне покрытия заменяет ближайшими допустимыми до инициализации стора', () => {
    useUiStore.getState().initialize(coverage, '?routes=17&h=period&start=2020-01-01&end=2030-01-01');
    expect(useUiStore.getState().filters).toMatchObject({ start: coverage.start, end: coverage.end });
    expect(useUiStore.getState().urlWarnings.join(' ')).toContain('01.11.2025');
    expect(parseUrl('?h=period&start=2025-12-01&end=2025-11-01', coverage).filters.end).toBe('2025-12-01');
  });
  it('обрезает год и не теряет горизонт после round-trip', () => {
    const short = { ...coverage, end: '2025-12-31' };
    const { filters } = parseUrl('?h=year&start=2025-11-01', short);
    expect(filters).toMatchObject({ horizon: 'year', end: '2025-12-31', granularity: 'week' });
    expect(parseUrl(serializeUrl(filters, 'overview'), short).warnings).toEqual([]);
  });
  it('без фильтров URL включает московское сейчас и следует часу/полуночи; ручная дата выключает', () => {
    const store = useUiStore.getState;
    store().initialize(coverage, '');
    expect(store()).toMatchObject({ nowMode: true, mapHour: 21, filters: { start: '2026-01-01' } });
    const original = store().filters;
    vi.setSystemTime(new Date('2026-01-01T19:00:00Z')); store().tickNow();
    expect(store().mapHour).toBe(22);
    expect(store().filters).toBe(original);
    vi.setSystemTime(new Date('2026-01-01T21:00:00Z')); store().tickNow();
    expect(store().filters?.start).toBe('2026-01-02');
    store().setDates('2025-11-03', '2025-11-03');
    store().tickNow();
    expect(store()).toMatchObject({ nowMode: false, filters: { start: '2025-11-03' } });
    store().goNow();
    expect(store()).toMatchObject({ nowMode: true, filters: { start: '2026-01-02' } });
    store().setMapHour(8); expect(store().nowMode).toBe(false);
  });
  it('не применяет неверные даты/часы; детализация сбрасывается при смене горизонта', () => {
    const store = useUiStore.getState;
    store().initialize(coverage, '?routes=17&start=2026-01-31');
    store().setHorizon('month');
    expect(store().filters).toMatchObject({ end: '2026-02-27', granularity: 'day' });
    const before = store().filters;
    store().setDates('2027-01-01', '2027-01-01');
    store().setHours({ from: 8, to: 7 });
    expect(store().filters).toBe(before);
    expect(store().validationError).not.toBeNull();
    store().setGranularity('month');
    store().setHorizon('year');
    expect(store().filters?.granularity).toBe('week');
  });
});
