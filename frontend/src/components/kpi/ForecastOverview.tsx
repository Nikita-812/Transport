import { Stack, Title } from '@mantine/core';
import { useMemo } from 'react';
import { calculateKpis } from '../../domain/aggregate';
import { useReadySeries, type ForecastResults } from '../../hooks/useForecastSeries';
import { useUiStore } from '../../state/store';
import { OverviewCharts } from '../charts/OverviewCharts';
import { ForecastStatus } from '../common/ForecastStatus';
import { KpiCards } from './KpiCards';

export function ForecastOverview({ forecast }: { forecast: ForecastResults }) {
  const filters = useUiStore((state) => state.filters);
  const coverage = useUiStore((state) => state.coverage);
  const series = useReadySeries(forecast);
  const kpis = useMemo(() => calculateKpis(series, filters?.hours), [series, filters?.hours]);
  if (!filters || !coverage) return null;
  return (
    <Stack gap="md" mt="lg">
      <Title order={2} size="h3">Прогноз посадок</Title>
      <ForecastStatus forecast={forecast} routes={filters.routes} coverage={coverage} />
      {series.length > 0 && <>
        <KpiCards kpis={kpis} />
        <OverviewCharts series={series} filters={filters} />
      </>}
    </Stack>
  );
}
