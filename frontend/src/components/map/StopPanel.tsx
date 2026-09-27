import { Alert, Badge, CloseButton, Group, Paper, SimpleGrid, Stack, Text, Title, useComputedColorScheme } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import { memo, useMemo } from 'react';
import type { RouteId } from '../../api/types';
import { ROUTE_COLORS } from '../../data/route-colors';
import { hourLabel, type HourRange } from '../../domain/aggregate';
import { formatDelta, formatInteger } from '../../domain/format';
import { stopHourProfile, type StopHourProfile } from '../../domain/mapLoad';
import type { StopCluster } from '../../domain/stops';
import type { ScenarioSeriesResult } from '../../hooks/useScenarioSeries';
import { chartPalette } from '../charts/chartTheme';
import { HourProfileChart } from '../charts/HourProfileChart';
import type { HourProfileData } from '../charts/series';

/** Обязательная подпись панели (spec route-load-map «Routes through a stop»). */
export const STOP_SUM_CAPTION = 'Сумма прогнозов маршрутов, а не посадки на остановке';

function chartData(profile: StopHourProfile, color: string): HourProfileData {
  return {
    hours: profile.hours,
    labels: profile.hours.map(hourLabel),
    lines: [{ route: null, name: 'Сумма маршрутов', color, values: profile.values }],
  };
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <Stack gap={2}>
      <Text size="xs" c="dimmed">{label}</Text>
      <Text fz="xl" fw={700} lh={1.2}>{value}</Text>
      <Text size="xs" c="dimmed">{detail}</Text>
    </Stack>
  );
}

interface StopPanelProps {
  stop: StopCluster;
  series: ScenarioSeriesResult;
  /** Маршруты фильтра: только они входят в сумму. */
  selectedRoutes: readonly RouteId[];
  hours: HourRange;
  /** Один день — прогноз этой даты; период — средний день. */
  singleDay: boolean;
  caption: string;
  onClose: () => void;
}

/**
 * Панель остановки. Прогноза по остановкам нет, поэтому здесь сумма прогнозов маршрутов, проходящих через
 * остановку, после сценария — с явной подписью. `stop_id` в API не отправляется.
 */
export const StopPanel = memo(function StopPanel({ stop, series, selectedRoutes, hours, singleDay, caption, onClose }: StopPanelProps) {
  const scheme = useComputedColorScheme('light');
  const color = chartPalette(scheme).total;
  const { notSelected, missing, counted } = useMemo(() => {
    const loaded = new Set(series.adjusted.map((item) => item.route));
    return {
      notSelected: stop.routes.filter((route) => !selectedRoutes.includes(route)),
      missing: stop.routes.filter((route) => selectedRoutes.includes(route) && !loaded.has(route)),
      counted: stop.routes.filter((route) => selectedRoutes.includes(route) && loaded.has(route)),
    };
  }, [stop.routes, selectedRoutes, series.adjusted]);
  const scenario = useMemo(() => stopHourProfile(series.adjusted, counted, hours), [series.adjusted, counted, hours]);
  const base = useMemo(() => stopHourProfile(series.base, counted, hours), [series.base, counted, hours]);
  const baseChart = useMemo(() => chartData(base, color), [base, color]);
  const scenarioChart = useMemo(() => (series.active ? chartData(scenario, color) : undefined), [series.active, scenario, color]);

  return (
    <Paper withBorder radius="lg" p="md" component="section" aria-label={`Остановка ${stop.name}`}>
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <div>
            <Text size="xs" c="dimmed">Остановка</Text>
            <Title order={3} size="h4">{stop.name}</Title>
          </div>
          <CloseButton aria-label="Закрыть панель остановки" onClick={onClose} />
        </Group>
        <Stack gap={4}>
          <Text size="sm" fw={600}>Маршруты через остановку</Text>
          <Group gap={6} aria-label="Маршруты через остановку">
            {stop.routes.map((route) => (
              <Badge key={route} color={ROUTE_COLORS[route]} variant={selectedRoutes.includes(route) ? 'filled' : 'outline'} autoContrast size="lg" radius="sm">
                {route}
              </Badge>
            ))}
          </Group>
        </Stack>
        <Alert color="gray" variant="light" icon={<IconInfoCircle size={18} aria-hidden />} p="xs">
          <Text size="sm">{STOP_SUM_CAPTION}: прогноза по остановкам у сервиса нет.</Text>
        </Alert>
        {notSelected.length > 0 && (
          <Text size="xs" c="dimmed">Не выбраны в фильтре и не входят в сумму: {notSelected.join(', ')}.</Text>
        )}
        {missing.length > 0 && (
          <Text size="xs" c="orange">Нет данных, в сумму не входят: {missing.join(', ')}.</Text>
        )}
        {counted.length > 0 ? (
          <>
            <SimpleGrid cols={2} spacing="sm">
              <Stat
                label={singleDay ? 'Итог за день' : 'Итог, в среднем за день'}
                value={formatInteger(scenario.total)}
                detail={`База: ${formatInteger(base.total)} · Δ ${formatDelta(scenario.total, base.total)}`}
              />
              <Stat
                label="Пиковый час"
                value={scenario.peak ? formatInteger(scenario.peak.value) : '—'}
                detail={scenario.peak ? `${hourLabel(scenario.peak.hour)} · маршруты: ${counted.join(', ')}` : 'Нет данных'}
              />
            </SimpleGrid>
            <HourProfileChart
              base={baseChart}
              scenario={scenarioChart}
              height={220}
              caption={caption}
              ariaLabel={`Сумма прогнозов маршрутов остановки «${stop.name}» по часам, ${caption}`}
            />
            <Text size="xs" c="dimmed">
              По часам, {caption}{series.active ? '. База — сплошная линия, сценарий — пунктир' : ''}.
            </Text>
          </>
        ) : (
          <Text size="sm" c="dimmed">Нет данных выбранных маршрутов этой остановки.</Text>
        )}
      </Stack>
    </Paper>
  );
});
