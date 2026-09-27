import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setApiTransport, type Transport } from './api/client';
import { App } from './App';
import { useUiStore } from './state/store';
import { renderWithProviders } from './test/render';

// MapLibre в jsdom не запускается (нет WebGL); вкладке карты здесь достаточно состояния загрузки.
vi.mock('./components/map/maplibre', () => ({ loadMaplibre: () => new Promise(() => {}) }));

const HEALTH = {
  ready: true,
  forecast_version: 'pooled_route_blend:1ad02854ca82',
  quality_passed: false,
  serving_mode: 'diagnostic',
  coverage: { start: '2025-11-01', end: '2026-10-31' },
};

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  window.history.replaceState(null, '', '/?routes=');
  useUiStore.setState({ tab: 'overview', panelOpen: false });
  window.localStorage.clear();
});

afterEach(() => setApiTransport(null));

describe('оболочка', () => {
  it('показывает загрузку, затем покрытие, версию и бейдж снимка', async () => {
    setApiTransport(() => Promise.resolve(ok(HEALTH)));
    renderWithProviders(<App />);
    expect(screen.getByRole('status')).toHaveTextContent('Подключение к сервису прогнозов');

    expect(await screen.findByRole('heading', { level: 1, name: 'Прогноз пассажиропотока трамваев' })).toBeInTheDocument();
    // Полная строка покрытия (от 992 px) и компактная под заголовком (узкие экраны); jsdom не применяет медиазапросы.
    expect(screen.getByText((_, element) => element?.textContent === 'Покрытие: 01.11.2025 — 31.10.2026 · 365 дней')).toBeInTheDocument();
    expect(screen.getByText('Покрытие: 01.11.2025 — 31.10.2026')).toBeInTheDocument();
    expect(screen.getByText('Версия: pooled_route_blend:1ad02854ca82')).toBeInTheDocument();
    expect(screen.getByText('Диагностический снимок')).toBeInTheDocument();
  });

  it('бейдж раскрывает пояснение о внутреннем пороге 0,95', async () => {
    setApiTransport(() => Promise.resolve(ok(HEALTH)));
    renderWithProviders(<App />);
    await userEvent.click(await screen.findByRole('button', { name: /Диагностический снимок/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/0,95/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Это не ошибка сервиса/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Подробнее о модели' }));
    expect(useUiStore.getState().tab).toBe('model');
  });

  it('вкладки: пять разделов, переключение с клавиатуры', async () => {
    setApiTransport(() => Promise.resolve(ok(HEALTH)));
    renderWithProviders(<App />);
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Обзор', 'Карта', 'Таблица', 'Выпуск и расписание', 'О модели']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');

    await userEvent.click(tabs[0] as HTMLElement);
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Карта' })).toHaveAttribute('aria-selected', 'true');
    expect(useUiStore.getState().tab).toBe('map');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Карта нагрузки');
  });

  it('тема: светлая по умолчанию, переключение сохраняется', async () => {
    setApiTransport(() => Promise.resolve(ok(HEALTH)));
    renderWithProviders(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Включить тёмную тему' }));
    expect(window.localStorage.getItem('tram-dashboard:color-scheme')).toBe('dark');
    expect(document.documentElement).toHaveAttribute('data-mantine-color-scheme', 'dark');
    await userEvent.click(screen.getByRole('button', { name: 'Включить светлую тему' }));
    expect(window.localStorage.getItem('tram-dashboard:color-scheme')).toBe('light');
  });

  it('недоступный сервис → экран ошибки → «Повторить» → дашборд', async () => {
    let up = false;
    const transport = vi.fn<Transport>(() => (up ? Promise.resolve(ok(HEALTH)) : Promise.reject(new TypeError('Failed to fetch'))));
    setApiTransport(transport);
    renderWithProviders(<App />);

    expect(await screen.findByRole('heading', { name: 'Сервис прогнозов недоступен' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось связаться с сервисом');
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.getByText('Технические подробности')).toBeInTheDocument();

    up = true;
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Прогноз пассажиропотока трамваев' })).toBeInTheDocument();
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('ответ 500 — тот же экран недоступности', async () => {
    setApiTransport(() => Promise.resolve(new Response('Internal Server Error', { status: 500 })));
    renderWithProviders(<App />);
    expect(await screen.findByRole('heading', { name: 'Сервис прогнозов недоступен' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Сервис ответил ошибкой 500');
  });

  it('ready: false — сервис не готов, данных нет', async () => {
    setApiTransport(() => Promise.resolve(ok({ ready: false, forecast_version: null, quality_passed: null, serving_mode: null, coverage: null })));
    renderWithProviders(<App />);
    expect(await screen.findByRole('heading', { name: 'Сервис прогнозов недоступен' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('снимок прогноза ещё не загружен');
  });

  it('рабочий снимок показывается нейтрально', async () => {
    setApiTransport(() => Promise.resolve(ok({ ...HEALTH, serving_mode: 'production', quality_passed: true })));
    renderWithProviders(<App />);
    expect(await screen.findByText('Рабочий снимок')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Диагностический снимок')).not.toBeInTheDocument());
  });
});
