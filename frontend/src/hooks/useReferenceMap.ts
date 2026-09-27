import { useQuery } from '@tanstack/react-query';
import { referenceMap } from '../api/client';

/**
 * `/reference-map`: остановки маршрутов 1, 5, 7, 11, 12 из справочника организаторов. Справочник входит
 * в снимок, поэтому ключ — версия прогноза, а ответ не устаревает. Запрос уходит при первом открытии карты.
 */
export function useReferenceMap(version: string) {
  return useQuery({
    queryKey: ['reference-map', version],
    queryFn: ({ signal }) => referenceMap(signal),
    staleTime: Infinity,
    retry: false,
  });
}
