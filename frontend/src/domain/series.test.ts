import { describe, expect, it } from 'vitest';
import { normalizeSeries } from './series';
import type { RawForecastRow } from '../api/types';

const rows: RawForecastRow[] = Array.from({ length: 24 }, (_, hour) => ({ route: 17, date: '2025-11-03', hour, prediction: hour / 10 }));
const normalize = (input: RawForecastRow[]) => normalizeSeries(17, '2025-11-03', '2025-11-03', input);
describe('полная почасовая сетка', () => {
  it('Float64Array, порядок строк не важен, настоящий ноль сохраняется', () => {
    const series = normalize([...rows].reverse());
    expect(series.values).toBeInstanceOf(Float64Array);
    expect(series.values[0]).toBe(0);
    expect(series.values[23]).toBe(2.3);
    expect(series.days).toBe(1);
  });
  it('пропуск, пустой ответ и дубликат — ошибки данных, а не нули', () => {
    expect(() => normalize(rows.slice(1))).toThrow('неполная почасовая сетка');
    expect(() => normalize([])).toThrow('неполная почасовая сетка');
    expect(() => normalize([...rows, rows[0]!])).toThrow('повтор');
  });
  it.each([
    { route: 1 }, { date: '2025-11-04' }, { date: '2025-02-31' }, { hour: 24 }, { hour: 0.5 },
    { prediction: -1 }, { prediction: NaN }, { prediction: Infinity },
  ])('не допускает повреждённые строки %j', (patch) => {
    expect(() => normalize([{ ...rows[0]!, ...patch } as RawForecastRow, ...rows.slice(1)])).toThrow();
  });
});
