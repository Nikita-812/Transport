import { screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { calculateKpis } from '../../domain/aggregate';
import { normalizeSeries } from '../../domain/series';
import { parseRawForecast } from '../../api/types';
import fixture from '../../test/fixtures/forecast-real.json';
import { formatInteger } from '../../domain/format';
import { renderWithProviders } from '../../test/render';
import { KpiCards } from './KpiCards';

it('маршрут 17 за день: показан итог 24 реальных строк, пик и среднее ru-RU', () => {
  const response = parseRawForecast(fixture.raw[1]);
  const rows = response.rows.filter((row) => row.date === fixture.start);
  const expected = rows.reduce((sum, row) => sum + row.prediction, 0);
  const kpis = calculateKpis([normalizeSeries(17, fixture.start, fixture.start, rows)]);
  renderWithProviders(<KpiCards kpis={kpis} />);
  expect(rows).toHaveLength(24);
  expect(Math.abs(kpis.total - expected)).toBeLessThanOrEqual(0.5);
  expect(within(screen.getByRole('region', { name: 'Всего посадок' })).getByText(formatInteger(expected), { collapseWhitespace: false })).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'В среднем за час' })).getByText(formatInteger(expected / 24), { collapseWhitespace: false })).toBeInTheDocument();
  expect(screen.getByText('№ 17')).toBeInTheDocument();
  expect(screen.getByText(/01.11.2025 ·/)).toBeInTheDocument();
});
