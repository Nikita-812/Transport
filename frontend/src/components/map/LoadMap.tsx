import { Alert, Button, Grid, Paper, Stack, Text, Title } from '@mantine/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReferenceRoute } from '../../api/types';
import { OSM_ROUTES } from '../../data/osm-routes';
import { ALL_HOURS } from '../../domain/aggregate';
import { daysInclusive, weekday } from '../../domain/dates';
import { formatDays, formatIsoDate, formatWeekdayLong, pluralRu } from '../../domain/format';
import { clampHour, loadScale, nextPlaybackHour, routeHourLoads } from '../../domain/mapLoad';
import { clusterStops, stopPoints, stopsForRoutes } from '../../domain/stops';
import type { ForecastResults } from '../../hooks/useForecastSeries';
import { useReadyHealth } from '../../hooks/useHealth';
import { useReferenceMap } from '../../hooks/useReferenceMap';
import type { ScenarioSeriesResult } from '../../hooks/useScenarioSeries';
import { useUiStore } from '../../state/store';
import type { Filters } from '../../state/url';
import { ForecastStatus } from '../common/ForecastStatus';
import { HourControls } from './HourControls';
import { MapLegend } from './MapLegend';
import { MapView } from './MapView';
import { hourPaint } from './paint';
import { STOP_SUM_CAPTION, StopPanel } from './StopPanel';

/** Шаг проигрывания суток (design D8). */
export const PLAYBACK_STEP_MS = 800;

const NO_REFERENCE: ReferenceRoute[] = [];

/** Подписи значений: один день — прогноз даты, период — среднее за день (spec «Load coloring»). */
function captions(filters: Filters) {
  if (filters.start === filters.end) {
    const day = formatWeekdayLong(weekday(filters.start)).toLowerCase();
    return { single: true, legend: `прогноз на ${formatIsoDate(filters.start)}, ${day}`, stop: `за ${formatIsoDate(filters.start)}` };
  }
  const days = formatDays(daysInclusive(filters.start, filters.end));
  return {
    single: false,
    legend: `в среднем за день, ${formatIsoDate(filters.start)} — ${formatIsoDate(filters.end)} (${days})`,
    stop: 'в среднем за день периода',
  };
}

/** Вкладка «Карта»: линии маршрутов в классах нагрузки выбранного часа, проигрывание суток и остановки. */
export function LoadMap({ forecast, series }: { forecast: ForecastResults; series: ScenarioSeriesResult }) {
  const health = useReadyHealth();
  const filters = useUiStore((state) => state.filters);
  const coverage = useUiStore((state) => state.coverage);
  const mapHour = useUiStore((state) => state.mapHour);
  const nowMode = useUiStore((state) => state.nowMode);
  const selectedStop = useUiStore((state) => state.selectedStop);
  const setSelectedStop = useUiStore((state) => state.setSelectedStop);
  const closeStop = useCallback(() => setSelectedStop(null), [setSelectedStop]);
  const reference = useReferenceMap(health.forecast_version);
  const [playing, setPlaying] = useState(false);

  const hours = filters?.hours ?? ALL_HOURS;
  const routes = useMemo(() => filters?.routes ?? [], [filters?.routes]);
  const single = hours.from === hours.to;
  const isPlaying = playing && !single;
  const hour = clampHour(mapHour, hours);

  // Значения и классы считаются один раз на данные и сценарий; час только выбирает готовое.
  const loads = useMemo(() => routeHourLoads(series.adjusted, hours), [series.adjusted, hours]);
  const scale = useMemo(() => loadScale(loads), [loads]);
  const paint = useMemo(() => hourPaint(loads, hour, scale), [loads, hour, scale]);

  // Пока справочник не ответил, остановок нет: иначе точки сменились бы с OSM на справочник на глазах.
  const referenceRoutes = reference.isSuccess ? reference.data.routes : reference.isError ? NO_REFERENCE : null;
  const stops = useMemo(() => (referenceRoutes === null ? [] : clusterStops(stopPoints(referenceRoutes, OSM_ROUTES.routes))), [referenceRoutes]);
  const visibleStops = useMemo(() => stopsForRoutes(stops, routes), [stops, routes]);
  const stop = visibleStops.find((item) => item.id === selectedStop) ?? null;
  const missing = useMemo(() => routes.filter((route) => !series.adjusted.some((item) => item.route === route)), [routes, series.adjusted]);

  // Таймер проигрывания живёт, пока открыта вкладка; размонтирование его очищает.
  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      const state = useUiStore.getState();
      state.setMapHour(nextPlaybackHour(state.mapHour, state.filters?.hours ?? ALL_HOURS));
    }, PLAYBACK_STEP_MS);
    return () => window.clearInterval(timer);
  }, [isPlaying]);

  if (!filters || !coverage) return null;
  const text = captions(filters);

  return (
    <Stack gap="md" mt="lg">
      <div>
        <Title order={2} size="h3">Карта нагрузки</Title>
        <Text size="sm" c="dimmed">Линии выбранных маршрутов окрашены по прогнозу посадок в выбранный час, {text.legend}.</Text>
      </div>
      <ForecastStatus forecast={forecast} routes={filters.routes} coverage={coverage} />
      {reference.isError && (
        <Alert color="yellow" title="Справочник остановок не загрузился">
          <Stack gap="xs" align="flex-start">
            <Text size="sm">Остановки маршрутов 1, 5, 7, 11, 12 показаны по OpenStreetMap. Линии и нагрузка от справочника не зависят.</Text>
            <Button size="compact-xs" variant="light" color="yellow" loading={reference.isFetching} onClick={() => void reference.refetch()}>Повторить</Button>
          </Stack>
        </Alert>
      )}
      {reference.isSuccess && reference.data.routes.length === 0 && (
        <Alert color="yellow">В снимке нет справочника организаторов: остановки всех маршрутов показаны по OpenStreetMap.</Alert>
      )}
      <Paper withBorder radius="lg" p="md">
        <Stack gap="sm">
          <HourControls
            hour={hour}
            hours={hours}
            playing={isPlaying}
            nowMode={nowMode}
            onHourChange={(next) => { setPlaying(false); useUiStore.getState().setMapHour(next); }}
            onTogglePlay={() => setPlaying((value) => !value)}
            onNow={() => { setPlaying(false); useUiStore.getState().goNow(); }}
          />
          <MapLegend scale={scale} caption={text.legend} missing={missing} />
        </Stack>
      </Paper>
      <Grid gap="md">
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <MapView routes={routes} paint={paint} stops={visibleStops} selectedStop={stop?.id ?? null} onSelectStop={setSelectedStop} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 4 }}>
          {stop ? (
            <StopPanel
              stop={stop}
              series={series}
              selectedRoutes={routes}
              hours={hours}
              singleDay={text.single}
              caption={text.stop}
              onClose={closeStop}
            />
          ) : (
            <Paper withBorder radius="lg" p="md" component="section" aria-label="Остановки">
              <Stack gap="xs">
                <Title order={3} size="h5">Остановки</Title>
                <Text size="sm">Нажмите на остановку на карте, чтобы увидеть прогноз проходящих через неё маршрутов по часам.</Text>
                <Text size="sm" c="dimmed">{STOP_SUM_CAPTION}: прогноза по остановкам у сервиса нет.</Text>
                <Text size="xs" c="dimmed">
                  {referenceRoutes === null
                    ? 'Загрузка остановок…'
                    : `На карте ${visibleStops.length} ${pluralRu(visibleStops.length, ['остановка', 'остановки', 'остановок'])} выбранных маршрутов.`}
                  {' '}Остановки 1, 5, 7, 11, 12 — из справочника организаторов, 17, 25, 26, 28, 50 — из OpenStreetMap; точки ближе 60 м
                  считаются одной остановкой.
                </Text>
              </Stack>
            </Paper>
          )}
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
