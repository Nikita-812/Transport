// Mock-адаптер должен отдавать ровно те формы, что и настоящий сервис: ответы прогоняются через те же
// парсеры контракта, что и клиент, а ошибки сверяются со строками и списками forecast_api.py.
import { afterEach, describe, expect, it } from 'vitest';
import { forecastAggregate, forecastRaw, health, referenceMap, setApiTransport } from './client';
import { ApiError, KNOWN_DETAILS } from './errors';
import { createMockTransport, handleMockRequest, MOCK_COVERAGE, MOCK_MARKER, mockPrediction } from './mock';
import { parseErrorDetail, parseHealth, parseRawForecast, parseReferenceMap, ROUTES, type AggregateGroupBy } from './types';

async function body(url: string): Promise<{ status: number; json: unknown }> {
  const response = handleMockRequest(url);
  return { status: response.status, json: (await response.json()) as unknown };
}

async function detailOf(url: string): Promise<unknown> {
  const { status, json } = await body(url);
  expect(status).toBe(422);
  return parseErrorDetail(json);
}

afterEach(() => setApiTransport(null));

describe('mock: формы ответов', () => {
  it('health — готовый годовой снимок в диагностическом режиме', async () => {
    const parsed = parseHealth((await body('/health')).json);
    expect(parsed).toMatchObject({ ready: true, serving_mode: 'diagnostic', quality_passed: false, coverage: MOCK_COVERAGE });
  });

  it('raw по одному маршруту: 24 строки на день, порядок дата → час', async () => {
    const parsed = parseRawForecast((await body('/forecasts?route=17&start_date=2025-11-03&end_date=2025-11-04')).json);
    expect(parsed.routes).toEqual([17]);
    expect(parsed.rows).toHaveLength(48);
    expect(parsed.rows[0]).toMatchObject({ route: 17, date: '2025-11-03', hour: 0 });
    expect(parsed.rows[47]).toMatchObject({ route: 17, date: '2025-11-04', hour: 23 });
  });

  it('годовое покрытие для всех 10 маршрутов', async () => {
    const parsed = parseRawForecast((await body(`/forecasts?routes=${ROUTES.join(',')}&start_date=${MOCK_COVERAGE.start}&end_date=${MOCK_COVERAGE.end}`)).json);
    expect(parsed.routes).toEqual([...ROUTES]);
    expect(parsed.rows).toHaveLength(10 * 365 * 24);
    expect(parsed.rows.every((row) => row.prediction >= 0)).toBe(true);
  });

  it.each<AggregateGroupBy>(['hour', 'day', 'week', 'month', 'weekday', 'season'])('group_by=%s — сумма совпадает с raw', async (groupBy) => {
    setApiTransport(createMockTransport());
    const query = { routes: [1, 17] as const, start: '2025-11-01', end: '2025-11-30' };
    const aggregate = await forecastAggregate({ ...query, groupBy });
    const raw = [...(await forecastRaw(1, query.start, query.end)).rows, ...(await forecastRaw(17, query.start, query.end)).rows];
    const total = (values: number[]) => values.reduce((sum, value) => sum + value, 0);
    expect(total(aggregate.rows.map((row) => row.prediction))).toBeCloseTo(total(raw.map((row) => row.prediction)), 3);
  });

  it('ключи агрегатов в форматах сервиса', async () => {
    setApiTransport(createMockTransport());
    const range = { routes: [7] as const, start: '2025-11-01', end: '2025-12-01' };
    const keys = async (groupBy: AggregateGroupBy) =>
      (await forecastAggregate({ ...range, groupBy })).rows.map((row) => (row as Record<string, string | number>)[groupBy]);
    expect(await keys('hour')).toContain('08:00');
    expect(await keys('week')).toContain('2025-W45');
    expect(await keys('month')).toEqual(['2025-11', '2025-12']);
    expect(await keys('weekday')).toEqual(['0', '1', '2', '3', '4', '5', '6']);
    expect(await keys('season')).toEqual(['autumn', 'winter']);
  });

  it('справочник: маршруты 1, 5, 7, 11, 12 с общими остановками 11 и 12', async () => {
    setApiTransport(createMockTransport());
    const map = await referenceMap();
    expect(map.routes.map((route) => route.route)).toEqual([1, 5, 7, 11, 12]);
    expect(map.forecast_available).toBe(false);
    const names = (route: number) => new Set(map.routes.find((item) => item.route === route)?.trips.flatMap((trip) => trip.stops.map((stop) => stop.name)));
    expect(names(11).has('Метро "Семёновская"') && names(12).has('Метро "Семёновская"')).toBe(true);
    expect(parseReferenceMap(map)).toEqual(map);
  });

  it('CSV-выгрузки', async () => {
    const exported = handleMockRequest('/forecasts/export.csv?route=17&start_date=2025-11-03&end_date=2025-11-03');
    expect(exported.headers.get('Content-Disposition')).toBe('attachment; filename=forecasts.csv');
    const lines = (await exported.text()).trim().split('\n');
    expect(lines[0]).toBe('route;date;hour;prediction');
    expect(lines).toHaveLength(25);
    const full = handleMockRequest('/forecasts.csv');
    expect(full.headers.get('Content-Disposition')).toBe('attachment; filename=forecast.csv');
    expect((await full.text()).trim().split('\n')).toHaveLength(1 + 10 * 61 * 24);
  });
});

describe('mock: данные', () => {
  it('детерминированы', () => {
    expect(mockPrediction(17, 100, 8)).toBe(mockPrediction(17, 100, 8));
  });

  it('будний день: пики около 8 и 18 ч выше ночи и полудня', () => {
    const day = 2; // 2025-11-03, понедельник
    const values = Array.from({ length: 24 }, (_, hour) => mockPrediction(11, day, hour));
    expect(values[8]).toBeGreaterThan(values[12] ?? Infinity);
    expect(values[18]).toBeGreaterThan(values[12] ?? Infinity);
    expect(values[8]).toBeGreaterThan(10 * (values[3] ?? Infinity));
  });

  it('выходной ниже будня в утренний пик', () => {
    expect(mockPrediction(11, 0, 8)).toBeLessThan(mockPrediction(11, 2, 8)); // суббота 01.11 и понедельник 03.11
  });
});

describe('mock: ошибки в форматах сервиса', () => {
  it.each([
    ['/forecasts?start_date=2025-11-01&end_date=2025-11-01', KNOWN_DETAILS.routeRequired],
    ['/forecasts?routes=a,b&start_date=2025-11-01&end_date=2025-11-01', KNOWN_DETAILS.badRoutes],
    ['/forecasts?routes=2&start_date=2025-11-01&end_date=2025-11-01', KNOWN_DETAILS.unsupportedRoute],
    ['/forecasts?route=17&start_date=2025-10-01&end_date=2025-11-01', KNOWN_DETAILS.outsideCoverage],
    ['/forecasts?route=17&start_date=2025-11-02&end_date=2025-11-01', KNOWN_DETAILS.outsideCoverage],
    ['/forecasts?route=17&start_date=2025-11-01&end_date=2025-11-01&hour=24', KNOWN_DETAILS.badHour],
    ['/forecasts?route=17&start_date=2025-11-01&end_date=2025-11-01&group_by=foo', KNOWN_DETAILS.badGroupBy],
    ['/forecasts?route=17&stop_id=1&start_date=2025-11-01&end_date=2025-11-01', KNOWN_DETAILS.stopsUnavailable],
  ])('%s → «%s»', async (url, detail) => {
    expect(await detailOf(url)).toBe(detail);
  });

  it('списочный detail для отсутствующих дат', async () => {
    expect(await detailOf('/forecasts?route=17')).toEqual([
      { type: 'missing', loc: ['query', 'start_date'], msg: 'Field required', input: null },
      { type: 'missing', loc: ['query', 'end_date'], msg: 'Field required', input: null },
    ]);
  });

  it('списочный detail для нечисловых маршрута и часа', async () => {
    const detail = (await detailOf('/forecasts?route=abc&start_date=2025-11-01&end_date=2025-11-01&hour=x')) as { type: string; loc: string[] }[];
    expect(detail.map((issue) => [issue.type, issue.loc[1]])).toEqual([
      ['int_parsing', 'route'],
      ['int_parsing', 'hour'],
    ]);
  });

  it('неизвестный путь — 404', async () => {
    expect(await body('/nope')).toEqual({ status: 404, json: { detail: 'Not Found' } });
  });

  it('клиент получает ApiError с detail', async () => {
    setApiTransport(createMockTransport());
    await expect(forecastRaw(17, '2024-01-01', '2024-01-01')).rejects.toMatchObject({ kind: 'http', status: 422, detail: KNOWN_DETAILS.outsideCoverage });
  });
});

describe('mock: транспорт', () => {
  it('health через клиент', async () => {
    setApiTransport(createMockTransport());
    await expect(health()).resolves.toMatchObject({ ready: true, forecast_version: expect.stringMatching(/^mock_synthetic:/) as unknown });
  });

  it('отменяется по signal', async () => {
    setApiTransport(createMockTransport({ latencyMs: 50 }));
    const controller = new AbortController();
    const pending = health(controller.signal);
    controller.abort();
    const error = await pending.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).kind).toBe('aborted');
  });

  it('содержит маркер для проверки сборки', () => {
    expect(MOCK_MARKER).toBe('__TRAM_API_MOCK__');
  });
});
