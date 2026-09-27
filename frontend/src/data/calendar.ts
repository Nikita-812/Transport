// Производственный календарь 2025 и 2026 годов. Даты скопированы из `calendar_2025.json` и
// `calendar_2026.json` в корне репозитория (их использует обучение модели), вместе с источниками.
// Названия праздников — по статье 112 Трудового кодекса РФ.
import type { IsoDate } from '../api/types';

export interface CalendarSource {
  title: string;
  url: string;
  covers: string;
}

export interface CalendarYear {
  year: number;
  /** Нерабочие праздничные дни. */
  holidays: IsoDate[];
  /** Выходные, перенесённые постановлением Правительства. */
  transferredDaysOff: IsoDate[];
  /** Рабочие субботы и воскресенья из-за переноса. */
  transferredWorkdays: IsoDate[];
  /** Сокращённые предпраздничные дни (ТК РФ, статья 95). */
  preholidays: IsoDate[];
  sources: CalendarSource[];
}

const TK_RF: CalendarSource = {
  title: 'Трудовой кодекс РФ, статьи 95 и 112',
  url: 'https://pravo.gov.ru/proxy/ips/?docbody=&nd=102074279',
  covers: 'Нерабочие праздничные и сокращённые предпраздничные дни',
};

export const CALENDAR: readonly CalendarYear[] = [
  {
    year: 2025,
    holidays: [
      '2025-01-01', '2025-01-02', '2025-01-03', '2025-01-04', '2025-01-05', '2025-01-06', '2025-01-07', '2025-01-08',
      '2025-02-23', '2025-03-08', '2025-05-01', '2025-05-09', '2025-06-12', '2025-11-04',
    ],
    transferredDaysOff: ['2025-05-02', '2025-05-08', '2025-06-13', '2025-11-03', '2025-12-31'],
    transferredWorkdays: ['2025-11-01'],
    preholidays: ['2025-03-07', '2025-04-30', '2025-06-11', '2025-11-01'],
    sources: [
      {
        title: 'Постановление Правительства РФ от 04.10.2024 № 1335',
        url: 'https://government.ru/docs/all/155500/',
        covers: 'Перенос выходных дней в 2025 году',
      },
      TK_RF,
    ],
  },
  {
    year: 2026,
    holidays: [
      '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08',
      '2026-02-23', '2026-03-08', '2026-05-01', '2026-05-09', '2026-06-12', '2026-11-04',
    ],
    transferredDaysOff: ['2026-01-09', '2026-03-09', '2026-05-11', '2026-12-31'],
    transferredWorkdays: [],
    preholidays: ['2026-04-30', '2026-05-08', '2026-06-11', '2026-11-03'],
    sources: [
      {
        title: 'Постановление Правительства РФ от 24.09.2025 № 1466',
        url: 'https://government.ru/docs/all/161028/',
        covers: 'Перенос выходных дней в 2026 году; опубликовано до origin 2025-11-01',
      },
      TK_RF,
    ],
  },
];

/** Названия праздников по дню и месяцу (ТК РФ, статья 112). */
const HOLIDAY_NAMES: Record<string, string> = {
  '01-01': 'Новогодние каникулы',
  '01-02': 'Новогодние каникулы',
  '01-03': 'Новогодние каникулы',
  '01-04': 'Новогодние каникулы',
  '01-05': 'Новогодние каникулы',
  '01-06': 'Новогодние каникулы',
  '01-07': 'Рождество Христово',
  '01-08': 'Новогодние каникулы',
  '02-23': 'День защитника Отечества',
  '03-08': 'Международный женский день',
  '05-01': 'Праздник Весны и Труда',
  '05-09': 'День Победы',
  '06-12': 'День России',
  '11-04': 'День народного единства',
};

export const TRANSFERRED_DAY_OFF = 'Перенесённый выходной';
export const TRANSFERRED_WORKDAY = 'Рабочий день по переносу';
export const PREHOLIDAY = 'Предпраздничный день';

export type CalendarDayKind = 'holiday' | 'transferredDayOff' | 'transferredWorkday' | 'preholiday';

export interface CalendarDay {
  date: IsoDate;
  kind: CalendarDayKind;
  name: string;
}

function dayOff(date: IsoDate, year: CalendarYear): CalendarDay | null {
  if (year.holidays.includes(date)) {
    return { date, kind: 'holiday', name: HOLIDAY_NAMES[date.slice(5)] ?? 'Нерабочий праздничный день' };
  }
  if (year.transferredDaysOff.includes(date)) return { date, kind: 'transferredDayOff', name: TRANSFERRED_DAY_OFF };
  return null;
}

/** Сведения календаря об одной дате; вне 2025–2026 годов — `null`. */
export function calendarDay(date: IsoDate): CalendarDay | null {
  const year = CALENDAR.find((item) => item.year === Number(date.slice(0, 4)));
  if (!year) return null;
  const off = dayOff(date, year);
  if (off) return off;
  if (year.transferredWorkdays.includes(date)) return { date, kind: 'transferredWorkday', name: TRANSFERRED_WORKDAY };
  if (year.preholidays.includes(date)) return { date, kind: 'preholiday', name: PREHOLIDAY };
  return null;
}

/**
 * Праздники и перенесённые выходные внутри включительного диапазона, по возрастанию даты.
 * Эти дни меняют пассажиропоток, поэтому именно они отмечаются на графике динамики.
 */
export function daysOffBetween(start: IsoDate, end: IsoDate): CalendarDay[] {
  return CALENDAR
    .flatMap((year) => [...year.holidays, ...year.transferredDaysOff]
      .filter((date) => date >= start && date <= end)
      .flatMap((date) => {
        const day = dayOff(date, year);
        return day ? [day] : [];
      }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export const CALENDAR_SOURCES: readonly CalendarSource[] = [
  ...CALENDAR.flatMap((year) => year.sources.filter((source) => source !== TK_RF)),
  TK_RF,
];
