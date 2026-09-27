import { QueryClient } from '@tanstack/react-query';

/**
 * Снимок прогноза неизменяем, а его версия входит в ключи запросов (design D4),
 * поэтому данные не устаревают и не перезапрашиваются при фокусе окна.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Infinity,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retry: false,
      },
    },
  });
}
