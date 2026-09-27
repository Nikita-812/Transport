import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { setApiTransport } from '../../api/client';
import { LOAD_SCALE } from '../../data/route-colors';
import { addDays, daysInclusive } from '../../domain/dates';
import { formatInteger } from '../../domain/format';
import { createDefaultScenario } from '../../domain/scenario';
import { useUiStore } from '../../state/store';
import fixture from '../../test/fixtures/forecast-real.json';
import referenceFixture from '../../test/fixtures/reference-map.json';
import { jsonResponse, requestUrl } from '../../test/forecast';
import { renderWithProviders } from '../../test/render';
import { PLAYBACK_STEP_MS } from './LoadMap';

// MapLibre в jsdom не работает (нет WebGL), поэтому подменяется записывающей заглушкой: тест проверяет,
// какие фильтры, paint-выражения и данные остановок получает карта и что делает панель остановки.
const fake = vi.hoisted(() => {
  type Handler = (event: unknown) => void;
  class FakeMap {
    static instances: FakeMap[] = [];
    handlers: { type: string; layer: string | null; handler: Handler }[] = [];
    paint: Record<string, Record<string, unknown>> = {};
    filters: Record<string, unknown> = {};
    stops: { features: { properties: { id: string; name: string; routes: string } }[] } | null = null;
    removed = false;
    touchZoomRotate = { disableRotation: () => undefined };
    constructor(public options: Record<string, unknown>) {
      FakeMap.instances.push(this);
    }
    addControl() { return this; }
    on(type: string, layer: string | Handler, handler?: Handler) {
      this.handlers.push(typeof layer === 'string' ? { type, layer, handler: handler! } : { type, layer: null, handler: layer });
      return this;
    }
    once(type: string, handler: Handler) { return this.on(type, handler); }
    isStyleLoaded() { return true; }
    getCanvas() { return { style: {} as Record<string, string> }; }
    setFilter(layer: string, filter: unknown) { this.filters[layer] = filter; }
    setPaintProperty(layer: string, name: string, value: unknown) { (this.paint[layer] ??= {})[name] = value; }
    getSource() {
      return { setData: (data: FakeMap['stops']) => { this.stops = data; return Promise.resolve(); } };
    }
    remove() { this.removed = true; }
    fire(type: string, layer: string | null, event: unknown) {
      for (const item of this.handlers) if (item.type === type && item.layer === layer) item.handler(event);
    }
  }
  class FakeMarker {
    element: HTMLElement;
    constructor(options: { element: HTMLElement }) { this.element = options.element; }
    setLngLat() { return this; }
    addTo() { document.body.append(this.element); return this; }
    getElement() { return this.element; }
    remove() { this.element.remove(); }
  }
  class FakePopup {
    setLngLat() { return this; }
    setDOMContent() { return this; }
    addTo() { return this; }
    remove() { return this; }
  }
  class FakeNavigationControl {}
  return { FakeMap, FakeMarker, FakePopup, FakeNavigationControl };
});

vi.mock('./maplibre', () => ({
  loadMaplibre: () => Promise.resolve({
    Map: fake.FakeMap, Marker: fake.FakeMarker, Popup: fake.FakePopup, NavigationControl: fake.FakeNavigationControl,
  }),
}));

const DAY = '2025-11-05';
/** Синтетический прогноз маршрутов, которых нет в фикстуре: ночью ноль, днём пик в 8 ч. */
const synthetic = (route: number, hour: number) => (hour < 5 ? 0 : route * 10 + (hour === 8 ? 900 : 200));
const realRows = new Map(fixture.raw.map((response) => [response.routes[0]!, response.rows]));
const calls: string[] = [];

function forecastRows(route: number, start: string, end: string) {
  const real = realRows.get(route);
  if (real) return real.filter((row) => row.date >= start && row.date <= end);
  return Array.from({ length: daysInclusive(start, end) * 24 }, (_, index) => ({
    route, date: addDays(start, Math.floor(index / 24)), hour: index % 24, prediction: synthetic(route, index % 24),
  }));
}

function open(search: string) {
  window.history.replaceState(null, '', `/?${search}&tab=map`);
  return renderWithProviders(<App />);
}

async function readyMap() {
  await waitFor(() => expect(fake.FakeMap.instances.at(-1)?.paint['route-line']?.['line-color']).toBeInstanceOf(Array));
  return fake.FakeMap.instances.at(-1)!;
}

/** Класс нагрузки 0–4 каждого маршрута по match-выражению цвета линии. */
function classes(map: InstanceType<typeof fake.FakeMap>): Map<number, number> {
  const expression = map.paint['route-line']!['line-color'] as unknown[];
  const result = new Map<number, number>();
  for (let index = 2; index < expression.length - 1; index += 2) {
    result.set(expression[index] as number, LOAD_SCALE.indexOf(expression[index + 1] as (typeof LOAD_SCALE)[number]));
  }
  return result;
}

beforeEach(() => {
  fake.FakeMap.instances = [];
  calls.length = 0;
  useUiStore.setState({ filters: null, tab: 'overview', panelOpen: false, selectedStop: null, scenario: createDefaultScenario() });
  setApiTransport(null);
  vi.stubGlobal('fetch', vi.fn<typeof fetch>((input) => {
    const url = new URL(requestUrl(input), 'http://localhost');
    calls.push(`${url.pathname}${url.search}`);
    if (url.pathname === '/health') return Promise.resolve(jsonResponse(fixture.health));
    if (url.pathname === '/reference-map') return Promise.resolve(jsonResponse(referenceFixture));
    const route = Number(url.searchParams.get('route'));
    const start = url.searchParams.get('start_date')!;
    const end = url.searchParams.get('end_date')!;
    return Promise.resolve(jsonResponse({
      forecast_version: fixture.health.forecast_version, routes: [route], group_by: 'raw', rows: forecastRows(route, start, end),
    }));
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.querySelectorAll('[role="img"][aria-label^="Маршрут"]').forEach((element) => element.remove());
});

describe('вкладка «Карта»', () => {
  it('линии выбранных маршрутов в классах часа; в 08:00 классы выше, чем в 03:00, запросов при смене часа нет', async () => {
    open(`routes=1,17&h=day&start=${DAY}&end=${DAY}`);
    const map = await readyMap();
    expect(map.filters['route-line']).toEqual(['in', ['get', 'route'], ['literal', [1, 17]]]);
    const requests = calls.length;

    act(() => useUiStore.getState().setMapHour(8));
    const morning = classes(map);
    const morningWidths = map.paint['route-line']!['line-width'];
    act(() => useUiStore.getState().setMapHour(3));
    const night = classes(map);
    expect([...morning.keys()]).toEqual([1, 17]);
    for (const route of [1, 17]) expect(morning.get(route)).toBeGreaterThan(night.get(route)!);
    expect(map.paint['route-line']!['line-width']).not.toEqual(morningWidths);
    expect(calls).toHaveLength(requests);
    expect(screen.getByRole('img', { name: /^Маршрут 17: \d.* посадок в час, класс нагрузки 1 из 5$/ })).toBeInTheDocument();
    // Легенда: 5 классов с границами в посадках в час и подпись даты.
    expect(within(screen.getByRole('list', { name: 'Классы нагрузки' })).getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getAllByText('прогноз на 05.11.2025, среда').length).toBeGreaterThan(0);
  });

  it('проигрывание: 0,8 с на час по кругу; таймер останавливается при размонтировании', async () => {
    const view = open(`routes=1,17&h=day&start=${DAY}&end=${DAY}`);
    await readyMap();
    act(() => useUiStore.getState().setMapHour(22));
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Проиграть' }));
    expect(screen.getByRole('button', { name: 'Пауза' })).toHaveAttribute('aria-pressed', 'true');
    act(() => { vi.advanceTimersByTime(PLAYBACK_STEP_MS); });
    expect(useUiStore.getState().mapHour).toBe(23);
    act(() => { vi.advanceTimersByTime(PLAYBACK_STEP_MS); });
    expect(useUiStore.getState().mapHour).toBe(0);
    view.unmount();
    act(() => { vi.advanceTimersByTime(PLAYBACK_STEP_MS * 5); });
    expect(useUiStore.getState().mapHour).toBe(0);
    expect(fake.FakeMap.instances.at(-1)!.removed).toBe(true);
  });

  it('«Метро „Комсомольская“»: сумма прогнозов маршрутов 7 и 50 с обязательной подписью, без stop_id', async () => {
    open(`routes=7,50&h=day&start=${DAY}&end=${DAY}`);
    const map = await readyMap();
    await waitFor(() => expect(map.stops?.features.length).toBeGreaterThan(0));
    const feature = map.stops!.features.find((item) => item.properties.name === 'Метро «Комсомольская»' && item.properties.routes === '7, 50')!;
    act(() => map.fire('click', 'stop-hit', { features: [feature] }));

    const panel = await screen.findByRole('region', { name: 'Остановка Метро «Комсомольская»' });
    expect(within(panel).getByText(/Сумма прогнозов маршрутов, а не посадки на остановке/)).toBeInTheDocument();
    expect(within(panel).getByLabelText('Маршруты через остановку')).toHaveTextContent('750');
    const expected = Array.from({ length: 24 }, (_, hour) => synthetic(7, hour) + synthetic(50, hour)).reduce((sum, value) => sum + value, 0);
    expect(within(panel).getByText(formatInteger(expected), { collapseWhitespace: false })).toBeInTheDocument();
    expect(within(panel).getByText('08:00 · маршруты: 7, 50')).toBeInTheDocument();
    expect(map.filters['stop-selected']).toEqual(['==', ['get', 'id'], feature.properties.id]);
    expect(calls.some((call) => call.includes('stop_id'))).toBe(false);
  });

  it('«Усадьба Останкино»: в панели маршруты 11, 17 и 25; невыбранный маршрут не входит в сумму', async () => {
    open(`routes=11,17&h=day&start=${DAY}&end=${DAY}`);
    const map = await readyMap();
    await waitFor(() => expect(map.stops?.features.length).toBeGreaterThan(0));
    const feature = map.stops!.features.find((item) => item.properties.name === 'Усадьба Останкино')!;
    expect(feature.properties.routes).toBe('11, 17, 25');
    act(() => map.fire('click', 'stop-hit', { features: [feature] }));

    const panel = await screen.findByRole('region', { name: 'Остановка Усадьба Останкино' });
    expect(within(within(panel).getByLabelText('Маршруты через остановку')).getAllByText(/^\d+$/).map((badge) => badge.textContent))
      .toEqual(['11', '17', '25']);
    expect(within(panel).getByText('Не выбраны в фильтре и не входят в сумму: 25.')).toBeInTheDocument();
  });

  it('сценарий пересчитывает карту и панель остановки без запросов', async () => {
    open(`routes=7,50&h=day&start=${DAY}&end=${DAY}`);
    const map = await readyMap();
    await waitFor(() => expect(map.stops?.features.length).toBeGreaterThan(0));
    const feature = map.stops!.features.find((item) => item.properties.name === 'Метро «Комсомольская»' && item.properties.routes === '7, 50')!;
    act(() => map.fire('click', 'stop-hit', { features: [feature] }));
    const panel = await screen.findByRole('region', { name: 'Остановка Метро «Комсомольская»' });
    const requests = calls.length;
    const widths = map.paint['route-line']!['line-width'];

    act(() => useUiStore.getState().updateScenarioRule('event', { enabled: true, multiplier: 2, routes: [7], hours: { from: 0, to: 23 } }));
    const base = Array.from({ length: 24 }, (_, hour) => synthetic(7, hour) + synthetic(50, hour)).reduce((sum, value) => sum + value, 0);
    const scenario = Array.from({ length: 24 }, (_, hour) => 2 * synthetic(7, hour) + synthetic(50, hour)).reduce((sum, value) => sum + value, 0);
    expect(within(panel).getByText(formatInteger(scenario), { collapseWhitespace: false })).toBeInTheDocument();
    expect(within(panel).getByText(`База: ${formatInteger(base)} · Δ +${((scenario / base - 1) * 100).toFixed(1).replace('.', ',')} %`, { collapseWhitespace: false }))
      .toBeInTheDocument();
    expect(map.paint['route-line']!['line-width']).not.toEqual(widths);
    expect(calls).toHaveLength(requests);
  });

  it('ошибки тайлов подложки не шумят, остальные ошибки карты видны в консоли', async () => {
    open(`routes=1,17&h=day&start=${DAY}&end=${DAY}`);
    const map = await readyMap();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    map.fire('error', null, { sourceId: 'osm', error: new Error('tile 503') });
    expect(warn).not.toHaveBeenCalled();
    map.fire('error', null, { error: new Error('WebGL context lost') });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
