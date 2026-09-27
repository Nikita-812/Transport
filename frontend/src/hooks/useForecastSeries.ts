import { useQueries } from '@tanstack/react-query';
import { forecastRaw } from '../api/client';
import type { RouteId } from '../api/types';
import type { DateRange } from '../domain/horizon';
import { normalizeSeries, RouteDataError } from '../domain/series';

/** Все маршруты запрашиваются параллельно; каждый результат и повтор независимы. */
export function useForecastSeries(version: string, routes: readonly RouteId[], range: DateRange) {
  const queries = useQueries({
    queries: routes.map((route) => ({
      queryKey: [version, route, range.start, range.end],
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const response = await forecastRaw(route, range.start, range.end, signal);
        if (response.forecast_version !== version) throw new RouteDataError(route, 'версия ответа отличается от снимка; обновите страницу');
        return normalizeSeries(route, range.start, range.end, response.rows);
      },
      staleTime: Infinity,
      retry: false,
    })),
  });
  return queries.map((query, index) => ({ ...query, route: routes[index]! }));
}

export type ForecastResults = ReturnType<typeof useForecastSeries>;
