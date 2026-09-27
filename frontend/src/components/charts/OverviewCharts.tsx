import { Grid, Paper, Stack, Text, Title, useComputedColorScheme } from '@mantine/core';
import { useMemo } from 'react';
import { daysInclusive } from '../../domain/dates';
import { formatDays } from '../../domain/format';
import type { RouteSeries } from '../../domain/series';
import type { Filters } from '../../state/url';
import { chartPalette } from './chartTheme';
import { DynamicsChart } from './DynamicsChart';
import { HourProfileChart } from './HourProfileChart';
import { buildDynamics, buildHeatmap, buildHourProfile } from './series';
import { WeekdayHourHeatmap } from './WeekdayHourHeatmap';

const GRANULARITY_NAMES = { hour: 'часам', day: 'дням', week: 'ISO-неделям', month: 'месяцам' } as const;

function ChartCard({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <Paper withBorder radius="lg" p="md" component="section" aria-label={title} h="100%">
      <Stack gap={4}>
        <Title order={3} size="h5">{title}</Title>
        <Text size="xs" c="dimmed">{hint}</Text>
        {children}
      </Stack>
    </Paper>
  );
}

/** Три графика «Обзора»: динамика, профиль часа суток и тепловая карта «день недели × час». */
export function OverviewCharts({ baseSeries, scenarioSeries, scenarioActive, filters }: {
  baseSeries: readonly RouteSeries[];
  scenarioSeries: readonly RouteSeries[];
  scenarioActive: boolean;
  filters: Filters;
}) {
  const scheme = useComputedColorScheme('light');
  const totalColor = chartPalette(scheme).total;
  const { hours, split, granularity, start, end } = filters;
  const lineOptions = useMemo(() => ({ hours, split, totalColor }), [hours, split, totalColor]);
  const baseDynamics = useMemo(() => buildDynamics(baseSeries, granularity, { start, end }, lineOptions), [baseSeries, granularity, start, end, lineOptions]);
  const scenarioDynamics = useMemo(() => scenarioActive
    ? buildDynamics(scenarioSeries, granularity, { start, end }, lineOptions)
    : undefined, [scenarioSeries, scenarioActive, granularity, start, end, lineOptions]);
  const baseHourProfile = useMemo(() => buildHourProfile(baseSeries, lineOptions), [baseSeries, lineOptions]);
  const scenarioHourProfile = useMemo(() => scenarioActive
    ? buildHourProfile(scenarioSeries, lineOptions)
    : undefined, [scenarioSeries, scenarioActive, lineOptions]);
  const heatmap = useMemo(() => buildHeatmap(scenarioSeries, hours), [scenarioSeries, hours]);
  const days = daysInclusive(start, end);
  const splitHint = split === 'routes' ? 'линии по маршрутам' : 'сумма выбранных маршрутов';

  return (
    <Stack gap="md">
      <ChartCard
        title="Динамика посадок"
        hint={`Корзины по ${GRANULARITY_NAMES[granularity]}, ${splitHint}. База — сплошная линия${scenarioActive ? ', сценарий — пунктир' : ''}. Полосы — праздники и перенесённые выходные.${baseDynamics.zoom ? ' Ряд длинный: масштаб меняется ползунком под графиком.' : ''}`}
      >
        <DynamicsChart base={baseDynamics} scenario={scenarioDynamics} />
      </ChartCard>
      <Grid gap="md">
        <Grid.Col span={{ base: 12, lg: 6 }}>
          <ChartCard title="Час суток" hint={`В среднем за день, ${splitHint}. База — сплошная линия${scenarioActive ? ', сценарий — пунктир' : ''}. Период: ${formatDays(days)}.`}>
            <HourProfileChart base={baseHourProfile} scenario={scenarioHourProfile} />
          </ChartCard>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 6 }}>
          <ChartCard title="День недели × час" hint={`В среднем за день, сумма выбранных маршрутов после сценария. Понедельник сверху.${scenarioActive ? ' Сценарий активен.' : ''}`}>
            <WeekdayHourHeatmap data={heatmap} />
          </ChartCard>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
