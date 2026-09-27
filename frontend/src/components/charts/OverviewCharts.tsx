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
export function OverviewCharts({ series, filters }: { series: readonly RouteSeries[]; filters: Filters }) {
  const scheme = useComputedColorScheme('light');
  const totalColor = chartPalette(scheme).total;
  const { hours, split, granularity, start, end } = filters;
  const lineOptions = useMemo(() => ({ hours, split, totalColor }), [hours, split, totalColor]);
  const dynamics = useMemo(() => buildDynamics(series, granularity, { start, end }, lineOptions), [series, granularity, start, end, lineOptions]);
  const hourProfile = useMemo(() => buildHourProfile(series, lineOptions), [series, lineOptions]);
  const heatmap = useMemo(() => buildHeatmap(series, hours), [series, hours]);
  const days = daysInclusive(start, end);
  const splitHint = split === 'routes' ? 'линии по маршрутам' : 'сумма выбранных маршрутов';

  return (
    <Stack gap="md">
      <ChartCard
        title="Динамика посадок"
        hint={`Корзины по ${GRANULARITY_NAMES[granularity]}, ${splitHint}. Полосы — праздники и перенесённые выходные.${dynamics.zoom ? ' Ряд длинный: масштаб меняется ползунком под графиком.' : ''}`}
      >
        <DynamicsChart data={dynamics} />
      </ChartCard>
      <Grid gap="md">
        <Grid.Col span={{ base: 12, lg: 6 }}>
          <ChartCard title="Час суток" hint={`В среднем за день, ${splitHint}. Период: ${formatDays(days)}.`}>
            <HourProfileChart data={hourProfile} />
          </ChartCard>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 6 }}>
          <ChartCard title="День недели × час" hint="В среднем за день, сумма выбранных маршрутов. Понедельник сверху.">
            <WeekdayHourHeatmap data={heatmap} />
          </ChartCard>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
