import { screen, within } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import type { HealthReady } from '../../api/types';
import { README_URL } from '../../data/model-info';
import { renderWithProviders } from '../../test/render';
import { ModelTab } from './ModelTab';

const health = (forecast_version: string): HealthReady => ({
  ready: true,
  forecast_version,
  quality_passed: false,
  serving_mode: 'diagnostic',
  coverage: { start: '2025-11-01', end: '2026-10-31' },
});

beforeEach(() => {
  document.body.innerHTML = '';
});

function metricsRow(period: string): string {
  const table = screen.getByRole('table', { name: 'WAPE-score по срезам проверки' });
  const cells = within(table).getByRole('cell', { name: period }).closest('tr')!.querySelectorAll('td');
  return cells[1]!.textContent ?? '';
}

it('pooled_route_blend: показаны все срезы проверки из справочника фактов', () => {
  renderWithProviders(<ModelTab health={health('pooled_route_blend:1ad02854ca82')} />);
  expect(metricsRow('Май–июнь')).toBe('0,861');
  expect(metricsRow('Июль–август')).toBe('0,835');
  expect(metricsRow('Сентябрь–октябрь')).toBe('0,840');
  expect(metricsRow('Ранние срезы вместе')).toBe('0,848');
  expect(screen.getByText(/этот срез изучался в eda/i)).toBeInTheDocument();
  expect(screen.getByText('Принятая модель')).toBeInTheDocument();
});

it('прежний frozen winner: 0,857 / 0,827 / 0,843', () => {
  renderWithProviders(<ModelTab health={health('hist_absolute_error_depth_8_lr_0.1_iter_300:1ad02854ca82')} />);
  expect(metricsRow('Май–июнь')).toBe('0,857');
  expect(metricsRow('Июль–август')).toBe('0,827');
  expect(metricsRow('Срезы вместе')).toBe('0,843');
});

it('неизвестная модель: только версия и ссылка на README, без метрик', () => {
  renderWithProviders(<ModelTab health={health('mock_synthetic:0001')} />);
  expect(screen.queryByRole('table', { name: 'WAPE-score по срезам проверки' })).toBeNull();
  expect(screen.queryByRole('region', { name: 'Проверено и не вошло в модель' })).toBeNull();
  expect(screen.queryByText(/0,8\d\d/)).toBeNull();
  expect(screen.getByText('mock_synthetic:0001')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /README проекта/ })).toHaveAttribute('href', README_URL);
});

it('качество: формула WAPE-score, baseline и протокол проверки', () => {
  renderWithProviders(<ModelTab health={health('pooled_route_blend:1ad02854ca82')} />);
  expect(screen.getByText('WAPE-score = max(0, 1 − WAPE)')).toBeInTheDocument();
  expect(screen.getByText('WAPE = Σ|y − ŷ| / Σy')).toBeInTheDocument();
  expect(screen.getByText(/baseline организаторов.*≈ 0,48/i)).toBeInTheDocument();
  expect(screen.getByText(/обучение только на прошлом, без обновления прогноза внутри горизонта/i)).toBeInTheDocument();
  expect(screen.getByText(/официальная оценка.*команде неизвестна/i)).toBeInTheDocument();
});

it('область определения: годовой горизонт с оговоркой про ноябрь и декабрь', () => {
  renderWithProviders(<ModelTab health={health('pooled_route_blend:1ad02854ca82')} />);
  const section = screen.getByRole('region', { name: 'Область определения' });
  expect(within(section).getByText(/ноябрь и декабрь не встречались в обучении/i)).toBeInTheDocument();
  expect(within(section).getByText(/тренда за пределами обучения не растёт/i)).toBeInTheDocument();
});

it('источники: постановления, ТК РФ, OpenStreetMap, Overpass и тайлы со ссылками', () => {
  renderWithProviders(<ModelTab health={health('pooled_route_blend:1ad02854ca82')} />);
  const section = screen.getByRole('region', { name: 'Источники данных' });
  const hrefs = within(section).getAllByRole('link').map((link) => link.getAttribute('href'));
  expect(hrefs).toContain('https://government.ru/docs/all/155500/');
  expect(hrefs).toContain('https://government.ru/docs/all/161028/');
  expect(hrefs).toContain('https://pravo.gov.ru/proxy/ips/?docbody=&nd=102074279');
  expect(hrefs).toContain('https://www.openstreetmap.org/copyright');
  expect(hrefs).toContain('https://operations.osmfoundation.org/policies/tiles/');
  expect(hrefs).toContain('https://open-meteo.com/en/docs/historical-weather-api');
});

it('источник погоды говорит, что и где измерено и что не оценено', () => {
  renderWithProviders(<ModelTab health={health('pooled_route_blend:1ad02854ca82')} />);
  const section = screen.getByRole('region', { name: 'Источники данных' });
  const row = within(section).getByRole('link', { name: /Open-Meteo/ }).closest('tr');
  expect(row).not.toBeNull();
  expect(row?.textContent).toContain('дождь ×0,93 (95% ДИ 0,90–0,97)');
  expect(row?.textContent).toContain('жара ×0,98 (интервал включает 1)');
  expect(row?.textContent).toContain('вневыборочных срезах май–октябрь 2025');
  expect(row?.textContent).toContain('зимние условия не оценены');
});

it('«Проверено и не вошло»: измеренный множитель ушёл в пресеты, а не в модель', () => {
  renderWithProviders(<ModelTab health={health('pooled_route_blend:1ad02854ca82')} />);
  const section = screen.getByRole('region', { name: 'Проверено и не вошло в модель' });
  expect(within(section).getByText(/взято в пресеты «Сценария», а не в модель/)).toBeInTheDocument();
  expect(within(section).getByText(/дождь ×0,93/)).toBeInTheDocument();
});

it('ограничения перечислены в одном разделе, снимок описан как диагностический', () => {
  renderWithProviders(<ModelTab health={health('pooled_route_blend:1ad02854ca82')} />);
  const section = screen.getByRole('region', { name: 'Ограничения' });
  const items = within(section).getAllByRole('listitem').map((item) => item.textContent);
  expect(items).toHaveLength(5);
  expect(items.join(' ')).toMatch(/прогноза по остановкам/i);
  expect(items.join(' ')).toMatch(/годовой горизонт не валидирован/i);
  expect(within(screen.getByRole('region', { name: 'Снимок прогноза' })).getByText('Диагностический снимок')).toBeInTheDocument();
});
