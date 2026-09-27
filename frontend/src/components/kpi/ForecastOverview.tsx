import { Alert, Button, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { useMemo } from 'react';
import { describeError } from '../../api/errors';
import { calculateKpis } from '../../domain/aggregate';
import { RouteDataError } from '../../domain/series';
import type { ForecastResults } from '../../hooks/useForecastSeries';
import { useUiStore } from '../../state/store';
import { KpiCards } from './KpiCards';

export function ForecastOverview({ forecast }: { forecast: ForecastResults }) {
  const filters = useUiStore((state) => state.filters);
  const coverage = useUiStore((state) => state.coverage);
  const kpis = useMemo(() => calculateKpis(forecast.flatMap((item) => item.isSuccess ? [item.data] : []), filters?.hours), [forecast, filters?.hours]);
  if (!filters || !coverage) return null;
  if (!filters.routes.length) return <Alert mt="md" color="blue">Выберите хотя бы один маршрут</Alert>;
  const readyCount = forecast.filter((item) => item.isSuccess).length;
  const pending = forecast.filter((item) => item.isPending);
  return (
    <Stack gap="md" mt="lg">
      <Title order={2} size="h3">Прогноз посадок</Title>
      {pending.length > 0 && <Group role="status"><Loader size="sm" /><Text size="sm">Загрузка маршрутов: {pending.map((item) => item.route).join(', ')}</Text></Group>}
      {forecast.filter((item) => item.isError).map((item) => {
        const error = item.error instanceof RouteDataError
          ? { title: 'Ошибка данных маршрута', message: item.error.message, details: undefined }
          : describeError(item.error, { coverage });
        return <Alert key={item.route} color="red" title={`Маршрут ${item.route} — ${error.title}`}>
          <Stack gap="xs">
            <Text size="sm">{error.message}</Text>
            {error.details && <details><summary>Технические подробности</summary><Text size="xs">{error.details}</Text></details>}
            <Button size="xs" variant="light" color="red" loading={item.isFetching} onClick={() => void item.refetch()} aria-label={`Повторить маршрут ${item.route}`}>Повторить</Button>
          </Stack>
        </Alert>;
      })}
      {readyCount > 0 && <>
        {readyCount < filters.routes.length && <Alert color="yellow">Неполный итог: учтены только загруженные маршруты ({readyCount} из {filters.routes.length}).</Alert>}
        <KpiCards kpis={kpis} />
      </>}
    </Stack>
  );
}
