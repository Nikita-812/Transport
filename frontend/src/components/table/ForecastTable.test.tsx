import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { setApiTransport } from '../../api/client';
import { CSV_BOM } from '../../domain/csv';
import { formatInteger } from '../../domain/format';
import fixture from '../../test/fixtures/forecast-real.json';
import { fixtureResponse, requestUrl } from '../../test/forecast';
import { renderWithProviders } from '../../test/render';
import { useUiStore } from '../../state/store';

const PERIOD = '?routes=1,17&h=period&start=2025-11-01&end=2025-11-07';
const rows = fixture.raw.flatMap((response) => response.rows);
const total = rows.reduce((sum, row) => sum + row.prediction, 0);

/** Снимок URL.createObjectURL: содержимое выгрузки читается из перехваченного Blob. */
function captureDownload() {
  const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  const blobs: Blob[] = [];
  Object.assign(URL, {
    createObjectURL: vi.fn((blob: Blob) => { blobs.push(blob); return 'blob:csv'; }),
    revokeObjectURL: vi.fn(),
  });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  return {
    blobs,
    click,
    restore: () => { Object.assign(URL, { createObjectURL: original.create, revokeObjectURL: original.revoke }); },
  };
}

beforeEach(() => {
  window.history.replaceState(null, '', `/${PERIOD}&tab=table`);
  useUiStore.setState({ filters: null, tab: 'overview', panelOpen: false });
  setApiTransport(null);
  vi.stubGlobal('fetch', vi.fn<typeof fetch>((input) => Promise.resolve(fixtureResponse(requestUrl(input)))));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('вкладка «Таблица»', () => {
  it('итоговая строка равна KPI, база равна прогнозу без сценария', async () => {
    renderWithProviders(<App />);
    const footer = await screen.findByRole('row', { name: 'Итого' });
    // Коэффициента сценария пока нет, поэтому база и прогноз совпадают: два одинаковых числа в строке.
    expect(within(footer).getAllByText(formatInteger(total), { collapseWhitespace: false })).toHaveLength(2);
    expect(within(footer).getByText('1,000')).toBeInTheDocument();
    expect(screen.getByText('Строки 1–14 из 14')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(1 + 14 + 1);

    await userEvent.click(screen.getByRole('tab', { name: 'Обзор' }));
    const kpi = await screen.findByRole('region', { name: 'Всего посадок' });
    expect(within(kpi).getByText(formatInteger(total), { collapseWhitespace: false })).toBeInTheDocument();
  });

  it('пагинация показывает по 50 строк, итог считается по всему виду', async () => {
    window.history.replaceState(null, '', `/${PERIOD}&g=hour&tab=table`);
    renderWithProviders(<App />);
    await screen.findByRole('row', { name: 'Итого' });
    expect(screen.getByText('Строки 1–50 из 336')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(1 + 50 + 1);
    expect(within(screen.getByRole('row', { name: 'Итого' })).getAllByText(formatInteger(total), { collapseWhitespace: false })).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Страница 2' }));
    expect(screen.getByText('Строки 51–100 из 336')).toBeInTheDocument();
  });

  it('смена детализации сбрасывает страницу на первую', async () => {
    window.history.replaceState(null, '', `/${PERIOD}&g=hour&tab=table`);
    renderWithProviders(<App />);
    await screen.findByRole('row', { name: 'Итого' });
    await userEvent.click(screen.getByRole('button', { name: 'Страница 3' }));
    expect(screen.getByText('Строки 101–150 из 336')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Детализация'), 'day');
    expect(screen.getByText('Строки 1–14 из 14')).toBeInTheDocument();
  });

  it('кнопка «Скачать CSV» отдаёт файл текущего вида с BOM и именем горизонта', async () => {
    const download = captureDownload();
    try {
      renderWithProviders(<App />);
      await screen.findByRole('row', { name: 'Итого' });
      await userEvent.click(screen.getByRole('button', { name: 'Скачать CSV' }));
      expect(download.blobs).toHaveLength(1);
      const anchor = download.click.mock.instances[0] as HTMLAnchorElement;
      expect(anchor.download).toBe('tram-forecast_period_2025-11-01_2025-11-07.csv');
      expect(anchor.href).toBe('blob:csv');
      // Blob.text() по спецификации срезает BOM, поэтому проверяем сами байты файла.
      const bytes = new Uint8Array(await download.blobs[0]!.arrayBuffer());
      expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      const content = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
      expect(content.startsWith(CSV_BOM)).toBe(true);
      const lines = content.slice(CSV_BOM.length).trimEnd().split('\r\n');
      expect(lines[0]).toBe('date;route;base_prediction;coefficient;prediction');
      expect(lines.slice(1).reduce((sum, line) => sum + Number(line.split(';')[4]), 0)).toBeCloseTo(total, 1);
      expect(document.querySelectorAll('a[download]')).toHaveLength(1);
    } finally {
      download.restore();
    }
  });

  it('ссылка на полный прогноз сервиса ведёт на /forecasts.csv', async () => {
    renderWithProviders(<App />);
    await screen.findByRole('row', { name: 'Итого' });
    expect(screen.getByRole('link', { name: /forecasts.csv/ })).toHaveAttribute('href', '/forecasts.csv');
  });
});
