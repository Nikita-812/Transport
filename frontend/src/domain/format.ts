// Форматирование для интерфейса: числа ru-RU, даты ДД.ММ.ГГГГ, склонение по числу.
import type { IsoDate } from '../api/types';

const integerFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

/** Целое в формате ru-RU (разряды через неразрывный пробел). Расчёты при этом не округляются (design D6). */
export function formatInteger(value: number): string {
  return integerFormat.format(value);
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
