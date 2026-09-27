import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { setApiTransport } from '../../api/client';
import { formatInteger } from '../../domain/format';
import { useUiStore } from '../../state/store';
import { fixtureResponse, requestUrl, jsonResponse } from '../../test/forecast';
import { renderWithProviders } from '../../test/render';
import fixture from '../../test/fixtures/forecast-real.json';

beforeEach(() => {
  window.history.replaceState(null, '', '/?routes=17&h=day&start=2025-11-01');
  useUiStore.setState({ filters: null, tab: 'overview', panelOpen: false });
  setApiTransport(null);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('панель, запросы и KPI как один поток', () => {
  it('часовой фильтр пересчитывает KPI без сети, пустой выбор ничего не запрашивает, кэш восстанавливает данные', async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => Promise.resolve(fixtureResponse(requestUrl(input))));
    vi.stubGlobal('fetch', fetchMock);
    const replace = vi.spyOn(window.history, 'replaceState');
    renderWithProviders(<App />);
    await screen.findByRole('region', { name: 'Всего посадок' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await userEvent.selectOptions(screen.getByLabelText('Часы с'), '7');
    await userEvent.selectOptions(screen.getByLabelText('Часы по'), '10');
    const expected = fixture.raw[1]!.rows.filter((r) => r.date === '2025-11-01' && r.hour >= 7 && r.hour <= 10).reduce((sum, r) => sum + r.prediction, 0);
    expect(within(screen.getByRole('region', { name: 'Всего посадок' })).getByText(formatInteger(expected), { collapseWhitespace: false })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new URLSearchParams(window.location.search).get('hours')).toBe('7-10');
    expect(replace).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Снять выбор' }));
    expect(screen.getAllByText('Выберите хотя бы один маршрут')).toHaveLength(2);
    expect(screen.queryByRole('region', { name: 'Всего посадок' })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await userEvent.click(screen.getByLabelText('Маршрут 17'));
    await screen.findByRole('region', { name: 'Всего посадок' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('перезагрузка URL восстанавливает маршруты, часы, разрез и вкладку', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>((input) => Promise.resolve(fixtureResponse(requestUrl(input)))));
    const { unmount } = renderWithProviders(<App />);
    await screen.findByRole('region', { name: 'Всего посадок' });
    await userEvent.click(screen.getByLabelText('Маршрут 1'));
    await userEvent.selectOptions(screen.getByLabelText('Разрез'), 'total');
    await userEvent.click(screen.getByRole('tab', { name: 'Карта' }));
    const url = window.location.search;
    unmount();
    renderWithProviders(<App />);
    expect(await screen.findByRole('tab', { name: 'Карта' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Маршрут 1')).toBeChecked();
    expect(screen.getByLabelText('Маршрут 17')).toBeChecked();
    expect(screen.getByLabelText('Разрез')).toHaveValue('total');
    expect(window.location.search).toBe(url);
  });
  it('заведомо неверные даты из URL не доходят до fetch', async () => {
    window.history.replaceState(null, '', '/?routes=17&start=2020-01-01&hours=bad');
    const fetchMock = vi.fn<typeof fetch>((input) => Promise.resolve(fixtureResponse(requestUrl(input))));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<App />);
    expect(await screen.findByText('Параметры ссылки исправлены')).toBeInTheDocument();
    await screen.findByRole('region', { name: 'Всего посадок' });
    expect(fetchMock.mock.calls.some(([url]) => requestUrl(url).includes('2020'))).toBe(false);
    expect(useUiStore.getState().filters?.start).toBe('2025-11-01');
  });
  it('ошибка маршрута не скрывает KPI остальных; виден неполный итог и повтор', async () => {
    window.history.replaceState(null, '', '/?routes=1,17&start=2025-11-01');
    vi.stubGlobal('fetch', vi.fn<typeof fetch>((input) => Promise.resolve(requestUrl(input).includes('route=17&') ? jsonResponse({}, 500) : fixtureResponse(requestUrl(input)))));
    renderWithProviders(<App />);
    await screen.findByRole('button', { name: 'Повторить маршрут 17' });
    expect(await screen.findByText(/Неполный итог/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Всего посадок' })).toBeInTheDocument();
    expect(screen.getByText('№ 1')).toBeInTheDocument();
  });
  it('StrictMode сохраняет режим Сейчас; смена московского часа не вызывает запросы', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2025-11-02T01:30:00+07:00'));
    window.history.replaceState(null, '', '/');
    const fetchMock = vi.fn<typeof fetch>((input) => Promise.resolve(fixtureResponse(requestUrl(input))));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<StrictMode><App /></StrictMode>);
    await waitFor(() => expect(useUiStore.getState().nowMode).toBe(true));
    await screen.findByRole('region', { name: 'Всего посадок' });
    const calls = fetchMock.mock.calls.length;
    expect(screen.getByText(/Москва · 21:00/)).toBeInTheDocument();
    vi.setSystemTime(new Date('2025-11-01T19:00:00Z'));
    act(() => useUiStore.getState().tickNow());
    expect(screen.getByText(/Москва · 22:00/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(calls);
  });
});
