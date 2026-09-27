import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RouteId } from '../api/types';
import { setApiTransport } from '../api/client';
import { createQueryClient } from '../queryClient';
import { fixtureResponse, requestUrl, fixtureVersion, jsonResponse } from '../test/forecast';
import { useForecastSeries } from './useForecastSeries';

afterEach(() => { vi.unstubAllGlobals(); setApiTransport(null); });
const range = { start: '2025-11-01', end: '2025-11-07' };
function harness() {
  const client = createQueryClient();
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> };
}

describe('параллельный запрос и кэш по версии/маршруту/диапазону', () => {
  it('запускает оба запроса до ответа, кэш переживает снятие/возврат выбора', async () => {
    const pending: (() => void)[] = [];
    const fetchMock = vi.fn<typeof fetch>((input) => new Promise((resolve) => pending.push(() => resolve(fixtureResponse(requestUrl(input))))));
    vi.stubGlobal('fetch', fetchMock);
    const { wrapper, client } = harness();
    const { result, rerender, unmount } = renderHook(({ routes }: { routes: RouteId[] }) => useForecastSeries(fixtureVersion, routes, range), { wrapper, initialProps: { routes: [1, 17] as RouteId[] } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.every((r) => r.isPending)).toBe(true);
    act(() => pending.forEach((resolve) => resolve()));
    await waitFor(() => expect(result.current.every((r) => r.isSuccess)).toBe(true));
    expect(client.getQueryData([fixtureVersion, 17, range.start, range.end])).toBeDefined();
    rerender({ routes: [] });
    expect(result.current).toEqual([]);
    rerender({ routes: [1, 17] });
    await waitFor(() => expect(result.current.every((r) => r.isSuccess)).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    unmount(); client.clear();
  });
  it('ошибка одного маршрута оставляет другой и повторяет только ошибочный', async () => {
    let failed = true;
    const fetchMock = vi.fn<typeof fetch>((input) => Promise.resolve(requestUrl(input).includes('route=17&') && failed ? jsonResponse({}, 500) : fixtureResponse(requestUrl(input))));
    vi.stubGlobal('fetch', fetchMock);
    const { wrapper, client } = harness();
    const { result, unmount } = renderHook(() => useForecastSeries(fixtureVersion, [1, 17], range), { wrapper });
    await waitFor(() => expect(result.current[1]!.isError).toBe(true));
    expect(result.current[0]!.data?.values).toHaveLength(168);
    failed = false;
    await act(() => result.current[1]!.refetch());
    await waitFor(() => expect(result.current[1]!.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    unmount(); client.clear();
  });
  it('отмена при смене дат и пустом выборе; новая версия не берётся из старого кэша', async () => {
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn<typeof fetch>((_input, init) => new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) throw new Error('Нет signal');
      signals.push(signal);
      signal.addEventListener('abort', () => reject(new DOMException('Отмена', 'AbortError')), { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { wrapper, client } = harness();
    const { result, rerender, unmount } = renderHook(({ start, routes, version }) => useForecastSeries(version, routes, { ...range, start }),
      { wrapper, initialProps: { start: range.start, routes: [17] as RouteId[], version: fixtureVersion } });
    rerender({ start: '2025-11-02', routes: [17], version: fixtureVersion });
    expect(signals[0]!.aborted).toBe(true);
    rerender({ start: '2025-11-02', routes: [], version: fixtureVersion });
    expect(signals[1]!.aborted).toBe(true);
    expect(result.current).toEqual([]);
    vi.stubGlobal('fetch', vi.fn<typeof fetch>((input) => Promise.resolve(fixtureResponse(requestUrl(input)))));
    rerender({ start: range.start, routes: [17], version: fixtureVersion });
    await waitFor(() => expect(result.current[0]!.isSuccess).toBe(true));
    rerender({ start: range.start, routes: [17], version: 'new-version' });
    await waitFor(() => expect(result.current[0]!.isError).toBe(true));
    expect(result.current[0]!.error?.message).toContain('версия ответа');
    expect(fetch).toHaveBeenCalledTimes(2);
    unmount(); client.clear();
  });
});
