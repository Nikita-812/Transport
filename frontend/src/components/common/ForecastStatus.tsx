import { Alert, Button, Group, Loader, Stack, Text } from '@mantine/core';
import { describeError } from '../../api/errors';
import type { Coverage, RouteId } from '../../api/types';
import { RouteDataError } from '../../domain/series';
import type { ForecastResults } from '../../hooks/useForecastSeries';

/**
 * Общие состояния данных прогноза для всех вкладок: пустой выбор, загрузка по маршрутам,
 * независимые ошибки с повтором и пометка неполного итога.
 */
export function ForecastStatus({ forecast, routes, coverage }: { forecast: ForecastResults; routes: readonly RouteId[]; coverage: Coverage }) {
  if (!routes.length) return <Alert color="blue">Выберите хотя бы один маршрут</Alert>;
  const pending = forecast.filter((item) => item.isPending);
  const failed = forecast.filter((item) => item.isError);
  const readyCount = forecast.filter((item) => item.isSuccess).length;
  return (
    <>
      {pending.length > 0 && (
        <Group role="status"><Loader size="sm" /><Text size="sm">Загрузка маршрутов: {pending.map((item) => item.route).join(', ')}</Text></Group>
      )}
      {failed.map((item) => {
        const error = item.error instanceof RouteDataError
          ? { title: 'Ошибка данных маршрута', message: item.error.message, details: undefined }
          : describeError(item.error, { coverage });
        return (
          <Alert key={item.route} color="red" title={`Маршрут ${item.route} — ${error.title}`}>
            <Stack gap="xs">
              <Text size="sm">{error.message}</Text>
              {error.details && <details><summary>Технические подробности</summary><Text size="xs">{error.details}</Text></details>}
              <Button size="xs" variant="light" color="red" loading={item.isFetching} onClick={() => void item.refetch()} aria-label={`Повторить маршрут ${item.route}`}>Повторить</Button>
            </Stack>
          </Alert>
        );
      })}
      {readyCount > 0 && readyCount < routes.length && (
        <Alert color="yellow">Неполный итог: учтены только загруженные маршруты ({readyCount} из {routes.length}).</Alert>
      )}
    </>
  );
}
