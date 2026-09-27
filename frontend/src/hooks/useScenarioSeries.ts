import { useMemo } from 'react';
import { applyScenario, hasActiveScenario, type ScenarioRouteSeries } from '../domain/scenario';
import type { RouteSeries } from '../domain/series';
import { useUiStore } from '../state/store';
import { useReadySeries, type ForecastResults } from './useForecastSeries';

export interface ScenarioSeriesResult {
  /** Неизменённый прогноз API. */
  base: readonly RouteSeries[];
  /** Почасовой прогноз после сценария вместе с коэффициентами каждой ячейки. */
  adjusted: readonly ScenarioRouteSeries[];
  active: boolean;
}

/** Единственный хук, через который представления получают применённый сценарий. */
export function useScenarioSeries(forecast: ForecastResults): ScenarioSeriesResult {
  const base = useReadySeries(forecast);
  const rules = useUiStore((state) => state.scenario);
  return useMemo(() => ({
    base,
    adjusted: applyScenario(base, rules),
    active: hasActiveScenario(rules),
  }), [base, rules]);
}
