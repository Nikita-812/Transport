import { useQuery } from '@tanstack/react-query';
import { health } from '../api/client';
import type { HealthReady } from '../api/types';

export const HEALTH_QUERY_KEY = ['health'] as const;

/**
 * `/health` при запуске. Снимок неизменяем, поэтому ответ не устаревает; повтор — только по кнопке,
 * чтобы экран «Сервис прогнозов недоступен» появлялся сразу, а не после серии скрытых попыток.
 */
export function useHealth() {
  return useQuery({
    queryKey: HEALTH_QUERY_KEY,
    queryFn: ({ signal }) => health(signal),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

/**
 * Готовый `/health` внутри дашборда: оболочка (App) показывает дашборд только после успешного ответа
 * с `ready: true`, поэтому здесь данные всегда есть.
 */
export function useReadyHealth(): HealthReady {
  const { data } = useHealth();
  if (!data?.ready) throw new Error('useReadyHealth вызван вне готового дашборда');
  return data;
}
