// Форматирование для интерфейса: числа ru-RU, даты ДД.ММ.ГГГГ, склонение по числу.
import type { IsoDate, Season } from '../api/types';
import type { BucketKind } from './aggregate';

const integerFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

/** Целое в формате ru-RU (разряды через неразрывный пробел). Расчёты при этом не округляются (design D6). */
export function formatInteger(value: number): string {
  return integerFormat.format(value);
}

const percentFormat = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero' });

/** Изменение сценария относительно базы: `formatDelta(48_487, 52_703)` → «−8,0 %». */
export function formatDelta(value: number, base: number): string {
  return `${percentFormat.format(base === 0 ? 0 : ((value - base) / base) * 100)} %`;
}

/** Число с заданным количеством знаков после запятой: `formatDecimal(0.861, 3)` → «0,861». */
export function formatDecimal(value: number, digits: number): string {
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

/** `2025-11-01` → `01.11.2025`, строковой перестановкой, без часовых поясов. */
export function formatIsoDate(date: IsoDate): string {
  const [y, m, d] = date.split('-');
  return `${d}.${m}.${y}`;
}

/** Форма слова по числу: `pluralRu(61, ['день', 'дня', 'дней'])` → «день», для 365 → «дней». */
export function pluralRu(count: number, forms: readonly [one: string, few: string, many: string]): string {
  const n = Math.abs(Math.trunc(count));
  const lastTwo = n % 100;
  const last = n % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return forms[2];
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}

export function formatDays(count: number): string {
  return `${formatInteger(count)} ${pluralRu(count, ['день', 'дня', 'дней'])}`;
}

const monthFormat = new Intl.DateTimeFormat('ru-RU', { month: 'long', timeZone: 'UTC' });
const shortMonthFormat = new Intl.DateTimeFormat('ru-RU', { month: 'short', timeZone: 'UTC' });
const weekdayFormat = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', timeZone: 'UTC' });
const longWeekdayFormat = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', timeZone: 'UTC' });

/** `пн`…`вс` по номеру дня недели (понедельник = 0, как у серверного `group_by=weekday`). */
export function formatWeekdayShort(weekday: number): string {
  return weekdayFormat.format(new Date(Date.UTC(2025, 11, 1 + weekday)));
}

/** `понедельник`…`воскресенье` по номеру дня недели. */
export function formatWeekdayLong(weekday: number): string {
  const name = longWeekdayFormat.format(new Date(Date.UTC(2025, 11, 1 + weekday)));
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** `2025-11` → `ноябрь 2025`; для оси графика — `нояб. 2025`. */
function formatMonthKey(key: string, short: boolean): string {
  const [year, month] = key.split('-');
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  return `${(short ? shortMonthFormat : monthFormat).format(date)} ${year}`;
}

/** Полная подпись корзины для подсказок, таблицы и заголовков. */
export function formatBucketTitle(key: string, kind: BucketKind): string {
  switch (kind) {
    case 'hour': {
      const [date, time] = key.split('T');
      return `${formatIsoDate(date!)} ${time!}`;
    }
    case 'day': return formatIsoDate(key);
    case 'week': return `${key.slice(6)}-я неделя ${key.slice(0, 4)}`;
    case 'month': return formatMonthKey(key, false);
    case 'hourOfDay': return key;
    case 'weekday': return formatWeekdayLong(Number(key));
    case 'season': return SEASON_NAMES[key as Season];
  }
}

/** Короткая подпись для оси: ось прячет перекрывающиеся подписи сама. */
export function formatBucketLabel(key: string, kind: BucketKind): string {
  switch (kind) {
    case 'hour': {
      const [date, time] = key.split('T');
      return `${date!.slice(8, 10)}.${date!.slice(5, 7)} ${time!}`;
    }
    case 'day': return `${key.slice(8, 10)}.${key.slice(5, 7)}`;
    case 'week': return `${key.slice(5)} ${key.slice(2, 4)}`;
    case 'month': return formatMonthKey(key, true);
    default: return formatBucketTitle(key, kind);
  }
}

export const SEASON_NAMES: Record<Season, string> = {
  winter: 'Зима', spring: 'Весна', summer: 'Лето', autumn: 'Осень',
};

/** Компактное число для подписей оси: `70 927 230` → «70,9 млн», `12 480` → «12 тыс.». */
export function formatCompact(value: number): string {
  const size = Math.abs(value);
  // Неразрывный пробел между числом и единицей: подпись оси не должна разрываться.
  if (size >= 1_000_000) return `${formatDecimal(value / 1_000_000, 1)}\u00a0млн`;
  if (size >= 10_000) return `${formatInteger(value / 1000)}\u00a0тыс.`;
  return formatInteger(value);
}
