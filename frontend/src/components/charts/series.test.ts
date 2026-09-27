import { describe, expect, it } from 'vitest';
import { parseRawForecast } from '../../api/types';
import { ROUTE_COLORS } from '../../data/route-colors';
import { normalizeSeries, type RouteSeries } from '../../domain/series';
import fixture from '../../test/fixtures/forecast-real.json';
import { buildDynamics, buildHeatmap, buildHourProfile, holidayMarks, ZOOM_THRESHOLD } from './series';

const HOURS = { from: 0, to: 23 };
const TOTAL_COLOR = '#343a40';

/** Два маршрута с постоянными значениями: проверяют раскладку серий, а не данные модели. */
const manual: RouteSeries[] = [
  { route: 1, start: '2025-11-03', days: 3, values: new Float64Array(72).fill(1) },
  { route: 17, start: '2025-11-03', days: 3, values: new Float64Array(72).fill(2) },
];

/** Годовое покрытие снимка D3: нужен только календарь оси, поэтому значения одинаковые. */
const year: RouteSeries[] = [{ route: 1, start: '2025-11-01', days: 365, values: new Float64Array(365 * 24).fill(1) }];
const YEAR_RANGE = { start: '2025-11-01', end: '2026-10-31' };

const real = fixture.raw.map((body) => {
  const response = parseRawForecast(body);
  return normalizeSeries(response.routes[0]!, fixture.start, fixture.end, response.rows);
});

describe('подготовка серий графика динамики', () => {
  it('разрез по маршрутам: своя линия и цвет палитры на общей оси корзин', () => {
    const data = buildDynamics(manual, 'day', { start: '2025-11-03', end: '2025-11-05' }, { hours: HOURS, split: 'routes', totalColor: TOTAL_COLOR });
    expect(data.keys).toEqual(['2025-11-03', '2025-11-04', '2025-11-05']);
    expect(data.labels).toEqual(['03.11', '04.11', '05.11']);
    expect(data.titles[0]).toBe('03.11.2025');
    expect(data.lines).toEqual([
      { route: 1, name: 'Маршрут 1', color: ROUTE_COLORS[1], values: [24, 24, 24] },
      { route: 17, name: 'Маршрут 17', color: ROUTE_COLORS[17], values: [48, 48, 48] },
    ]);
    expect(data.zoom).toBe(false);
  });

  it('разрез «Итог»: одна линия цвета темы, значения — сумма маршрутов, часы учитываются', () => {
    const data = buildDynamics(manual, 'day', { start: '2025-11-03', end: '2025-11-05' }, { hours: { from: 7, to: 10 }, split: 'total', totalColor: TOTAL_COLOR });
    expect(data.lines).toEqual([{ route: null, name: 'Итог', color: TOTAL_COLOR, values: [12, 12, 12] }]);
  });

  it('часовая детализация подписывает дату и час, длинный ряд получает dataZoom', () => {
    const data = buildDynamics(manual, 'hour', { start: '2025-11-03', end: '2025-11-05' }, { hours: HOURS, split: 'total', totalColor: TOTAL_COLOR });
    expect(data.keys).toHaveLength(72);
    expect(data.keys[8]).toBe('2025-11-03T08:00');
    expect(data.labels[8]).toBe('03.11 08:00');
    expect(data.titles[8]).toBe('03.11.2025 08:00');
    expect(data.zoom).toBe(true);
    expect(72).toBeGreaterThan(ZOOM_THRESHOLD);
  });

  it('недельная и месячная оси подписаны по-русски', () => {
    const weeks = buildDynamics(year, 'week', YEAR_RANGE, { hours: HOURS, split: 'total', totalColor: TOTAL_COLOR });
    expect(weeks.keys[0]).toBe('2025-W44');
    expect(weeks.titles[0]).toBe('44-я неделя 2025');
    expect(weeks.labels[0]).toBe('W44 25');
    const months = buildDynamics(year, 'month', YEAR_RANGE, { hours: HOURS, split: 'total', totalColor: TOTAL_COLOR });
    expect(months.keys).toHaveLength(12);
    expect(months.titles[0]).toBe('ноябрь 2025');
    expect(months.labels[0]).toBe('нояб. 2025');
  });
});

describe('отметки производственного календаря', () => {
  it('на горизонте «Год» видны 4 ноября 2025 и новогодние праздники 2026', () => {
    const data = buildDynamics(year, 'week', YEAR_RANGE, { hours: HOURS, split: 'total', totalColor: TOTAL_COLOR });
    const unity = data.marks.find((mark) => mark.name.includes('День народного единства'));
    expect(unity).toBeDefined();
    expect(data.keys[unity!.from]).toBe('2025-W45');
    expect(data.notes[unity!.from]).toContain('День народного единства');

    const newYear = data.marks.find((mark) => mark.name.includes('Новогодние каникулы'));
    expect(newYear).toBeDefined();
    expect(newYear!.name).toContain('Рождество Христово');
    expect(data.keys.slice(newYear!.from, newYear!.to + 1)).toContain('2026-W02');
    expect(data.marks.every((mark) => mark.from <= mark.to)).toBe(true);
  });

  it('дневная ось: соседние нерабочие дни — одна полоса, одиночные праздники — отдельные', () => {
    const range = { start: '2025-11-01', end: '2025-11-30' };
    const days = [{ route: 1 as const, start: range.start, days: 30, values: new Float64Array(30 * 24).fill(1) }];
    const data = buildDynamics(days, 'day', range, { hours: HOURS, split: 'total', totalColor: TOTAL_COLOR });
    expect(data.marks).toEqual([{ name: 'Перенесённый выходной, День народного единства', from: 2, to: 3 }]);
    expect(data.notes[0]).toBe('Рабочий день по переносу');
    expect(data.notes[3]).toBe('День народного единства');
    expect(data.notes[4]).toBeNull();
  });

  it('вне корзин оси отметок нет', () => {
    expect(holidayMarks('2025-11-05', '2025-11-06', 'day', HOURS, ['2025-11-05', '2025-11-06'])).toEqual([]);
  });
});

describe('профиль часа суток и тепловая карта на реальном снимке', () => {
  it('профиль — среднее за день по каждому часу выбранного диапазона', () => {
    const data = buildHourProfile(real, { hours: { from: 7, to: 10 }, split: 'routes', totalColor: TOTAL_COLOR });
    expect(data.labels).toEqual(['07:00', '08:00', '09:00', '10:00']);
    expect(data.hours).toEqual([7, 8, 9, 10]);
    expect(data.lines.map((line) => line.route)).toEqual([1, 17]);
    const route17 = real.find((item) => item.route === 17)!;
    const expected = Array.from({ length: route17.days }, (_, day) => route17.values[day * 24 + 8]!).reduce((sum, value) => sum + value, 0) / route17.days;
    expect(data.lines[1]!.values[1]!).toBeCloseTo(expected, 6);
  });

  it('тепловая карта: понедельник сверху, в будни пики около 8 и 18 часов', () => {
    const data = buildHeatmap(real, HOURS);
    expect(data.weekdayLabels).toEqual(['вс', 'сб', 'пт', 'чт', 'ср', 'вт', 'пн']);
    expect(data.hourLabels).toHaveLength(24);
    expect(data.cells).toHaveLength(7 * 24);
    const valueAt = (weekday: number, hour: number) => {
      const y = data.weekdayLabels.length - 1 - weekday;
      return data.cells.find((cell) => cell[0] === hour && cell[1] === y)![2];
    };
    for (const weekday of [2, 3]) {
      const hours = Array.from({ length: 24 }, (_, hour) => hour);
      const morning = hours.filter((hour) => hour < 12).sort((a, b) => valueAt(weekday, b) - valueAt(weekday, a))[0];
      const evening = hours.filter((hour) => hour >= 12).sort((a, b) => valueAt(weekday, b) - valueAt(weekday, a))[0];
      expect(morning).toBe(8);
      expect(evening).toBe(18);
    }
    expect(data.max).toBeCloseTo(Math.max(...data.cells.map((cell) => cell[2])), 9);
    expect(data.min).toBeGreaterThanOrEqual(0);
  });

  it('диапазон часов обрезает и карту', () => {
    const data = buildHeatmap(real, { from: 7, to: 10 });
    expect(data.hourLabels).toEqual(['07:00', '08:00', '09:00', '10:00']);
    expect(data.cells).toHaveLength(7 * 4);
  });
});
