import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it } from 'vitest';
import type { RouteId } from '../../api/types';
import { formatInteger } from '../../domain/format';
import { DEFAULT_ASSUMPTIONS } from '../../domain/planning';
import type { RouteSeries } from '../../domain/series';
import { useUiStore } from '../../state/store';
import { renderWithProviders } from '../../test/render';
import { PlanningTab } from './PlanningTab';

/** Постоянный час: за один день пик равен `perHour`, поэтому B задаётся прямо. */
function series(route: RouteId, perHour: number): RouteSeries {
  return { route, start: '2025-11-05', days: 1, values: new Float64Array(24).fill(perHour) };
}

function renderTab(routes: RouteSeries[]) {
  useUiStore.getState().initialize({ start: '2025-11-01', end: '2026-10-31' }, '?routes=17,5&h=day&start=2025-11-05&end=2025-11-05');
  useUiStore.getState().setPlanningAssumptions(DEFAULT_ASSUMPTIONS);
  return renderWithProviders(
    <PlanningTab forecast={[]} series={{ base: routes, adjusted: routes.map((item) => ({ ...item, coefficients: new Float64Array(24).fill(1) })), active: false }} />,
  );
}

function row(route: string): HTMLElement {
  return screen.getByRole('cell', { name: route }).closest('tr')!;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

it('B = 1000 при значениях по умолчанию — 3 рейса в час и интервал 20 мин', () => {
  renderTab([series(17, 1000)]);
  const cells = within(row('17')).getAllByRole('cell').map((cell) => cell.textContent);
  expect(cells).toEqual(['17', '00:00', formatInteger(1000), '3', '20 мин']);
});

it('B = 0 — «нет потребности» и прочерк вместо интервала, без деления на ноль', () => {
  renderTab([series(5, 0)]);
  const cells = within(row('5')).getAllByRole('cell').map((cell) => cell.textContent);
  expect(cells).toEqual(['5', '00:00', '0', 'Нет потребности', '—']);
});

it('вместимость 250 вместо 180 пересчитывает таблицу сразу', async () => {
  const user = userEvent.setup();
  renderTab([series(17, 1000)]);
  const capacity = screen.getByRole('textbox', { name: /Вместимость вагона/ });
  await user.clear(capacity);
  await user.type(capacity, '250');
  const cells = within(row('17')).getAllByRole('cell').map((cell) => cell.textContent);
  expect(cells.slice(3)).toEqual(['2', '30 мин']);
  expect(useUiStore.getState().planning.capacity).toBe(250);
});

it('пояснение о допущениях видно без дополнительных действий', () => {
  renderTab([series(17, 1000)]);
  expect(screen.getByText(/посадки в час — это не наполнение вагона/i)).toBeInTheDocument();
  expect(screen.getByText(/калибровать по обследованиям пассажиропотока/i)).toBeInTheDocument();
  expect(screen.getByText(/⌈B × s \/ \(C × f\)⌉/)).toBeInTheDocument();
});
