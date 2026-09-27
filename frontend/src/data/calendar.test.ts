/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CALENDAR, CALENDAR_SOURCES, calendarDay, daysOffBetween } from './calendar';

/** Те же файлы использует обучение модели: копия в `calendar.ts` не должна расходиться с ними. */
function repoCalendar(year: number): {
  year: number; holidays: string[]; transferred_days_off: string[]; transferred_workdays: string[];
  preholidays: string[]; sources: { title: string; url: string; covers: string }[];
} {
  // Тесты запускаются из `frontend/`, файлы календаря лежат в корне репозитория.
  const path = resolve(process.cwd(), '..', `calendar_${year}.json`);
  return JSON.parse(readFileSync(path, 'utf8')) as ReturnType<typeof repoCalendar>;
}

describe('производственный календарь', () => {
  for (const year of [2025, 2026]) {
    it(`${year}: даты и источники совпадают с calendar_${year}.json`, () => {
      const source = repoCalendar(year);
      const copy = CALENDAR.find((item) => item.year === year)!;
      expect(copy.holidays).toEqual(source.holidays);
      expect(copy.transferredDaysOff).toEqual(source.transferred_days_off);
      expect(copy.transferredWorkdays).toEqual(source.transferred_workdays);
      expect(copy.preholidays).toEqual(source.preholidays);
      expect(copy.sources).toEqual(source.sources);
    });
  }

  it('названия по ТК РФ, статья 112', () => {
    expect(calendarDay('2026-01-05')).toEqual({ date: '2026-01-05', kind: 'holiday', name: 'Новогодние каникулы' });
    expect(calendarDay('2026-01-07')?.name).toBe('Рождество Христово');
    expect(calendarDay('2026-01-08')?.name).toBe('Новогодние каникулы');
    expect(calendarDay('2026-02-23')?.name).toBe('День защитника Отечества');
    expect(calendarDay('2026-03-08')?.name).toBe('Международный женский день');
    expect(calendarDay('2026-05-01')?.name).toBe('Праздник Весны и Труда');
    expect(calendarDay('2026-05-09')?.name).toBe('День Победы');
    expect(calendarDay('2026-06-12')?.name).toBe('День России');
    expect(calendarDay('2025-11-04')?.name).toBe('День народного единства');
  });

  it('переносы и предпраздничные дни отличаются от праздников', () => {
    expect(calendarDay('2025-11-03')).toEqual({ date: '2025-11-03', kind: 'transferredDayOff', name: 'Перенесённый выходной' });
    expect(calendarDay('2025-11-01')).toEqual({ date: '2025-11-01', kind: 'transferredWorkday', name: 'Рабочий день по переносу' });
    expect(calendarDay('2026-11-03')).toEqual({ date: '2026-11-03', kind: 'preholiday', name: 'Предпраздничный день' });
    expect(calendarDay('2025-11-05')).toBeNull();
    expect(calendarDay('2024-01-01')).toBeNull();
  });

  it('нерабочие дни диапазона идут по возрастанию даты и не выходят за границы', () => {
    const days = daysOffBetween('2025-12-30', '2026-01-10');
    expect(days.map((day) => day.date)).toEqual([
      '2025-12-31', '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04',
      '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09',
    ]);
    expect(days.at(0)?.name).toBe('Перенесённый выходной');
    expect(days.at(-1)?.name).toBe('Перенесённый выходной');
    expect(daysOffBetween('2025-11-05', '2025-11-06')).toEqual([]);
  });

  it('источники приведены без повторов и со ссылками', () => {
    expect(CALENDAR_SOURCES).toHaveLength(3);
    expect(new Set(CALENDAR_SOURCES.map((source) => source.url)).size).toBe(3);
    expect(CALENDAR_SOURCES.every((source) => source.url.startsWith('https://'))).toBe(true);
  });
});
