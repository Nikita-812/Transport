import { Stack, Title } from '@mantine/core';
import { useMemo } from 'react';
import { calculateKpis } from '../../domain/aggregate';
import type { ForecastResults } from '../../hooks/useForecastSeries';
import type { ScenarioSeriesResult } from '../../hooks/useScenarioSeries';
import { useUiStore } from '../../state/store';
import { OverviewCharts } from '../charts/OverviewCharts';
import { ForecastStatus } from '../common/ForecastStatus';
import { KpiCards } from './KpiCards';

export function ForecastOverview({ forecast, series }: { forecast: ForecastResults; series: ScenarioSeriesResult }) {
  const filters = useUiStore((state) => state.filters);
  const coverage = useUiStore((state) => state.coverage);
  const baseKpis = useMemo(() => calculateKpis(series.base, filters?.hours), [series.base, filters?.hours]);
  const kpis = useMemo(() => calculateKpis(series.adjusted, filters?.hours), [series.adjusted, filters?.hours]);
  if (!filters || !coverage) return null;
  return (
    <Stack gap="md" mt="lg">
      <Title order={2} size="h3">Прогноз посадок</Title>
      <ForecastStatus forecast={forecast} routes={filters.routes} coverage={coverage} />
      {series.base.length > 0 && <>
        <KpiCards kpis={kpis} baseKpis={baseKpis} />
        <OverviewCharts baseSeries={series.base} scenarioSeries={series.adjusted} scenarioActive={series.active} filters={filters} />
      </>}
    </Stack>
  );
}
