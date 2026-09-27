import { ScrollArea, Tabs } from '@mantine/core';
import { IconCalendarTime, IconInfoCircle, IconLayoutDashboard, IconMap, IconTable, type Icon } from '@tabler/icons-react';
import { isTabId, TABS, useUiStore, type TabId } from '../../state/store';
import classes from './layout.module.css';
import type { ForecastResults } from '../../hooks/useForecastSeries';
import { useReadyHealth } from '../../hooks/useHealth';
import type { ScenarioSeriesResult } from '../../hooks/useScenarioSeries';
import { ForecastOverview } from '../kpi/ForecastOverview';
import { LoadMap } from '../map/LoadMap';
import { MapErrorBoundary } from '../map/MapErrorBoundary';
import { ModelTab } from '../model/ModelTab';
import { PlanningTab } from '../planning/PlanningTab';
import { ForecastTable } from '../table/ForecastTable';

const TAB_ICONS: Record<TabId, Icon> = {
  overview: IconLayoutDashboard,
  map: IconMap,
  table: IconTable,
  planning: IconCalendarTime,
  model: IconInfoCircle,
};

export function DashboardTabs({ forecast, series }: { forecast: ForecastResults; series: ScenarioSeriesResult }) {
  const health = useReadyHealth();
  const tab = useUiStore((state) => state.tab);
  const setTab = useUiStore((state) => state.setTab);

  return (
    <Tabs value={tab} onChange={(value) => isTabId(value) && setTab(value)} keepMounted={false}>
      <ScrollArea type="auto" scrollbarSize={4} offsetScrollbars="x">
        <Tabs.List className={classes.tabsList} aria-label="Разделы дашборда">
          {TABS.map(({ value, label }) => {
            const TabIcon = TAB_ICONS[value];
            return (
              <Tabs.Tab key={value} value={value} className={classes.tab} leftSection={<TabIcon size={16} aria-hidden />}>
                {label}
              </Tabs.Tab>
            );
          })}
        </Tabs.List>
      </ScrollArea>
      {TABS.map(({ value }) => (
        <Tabs.Panel key={value} value={value}>
          {value === 'overview' ? <ForecastOverview forecast={forecast} series={series} />
            : value === 'map' ? <MapErrorBoundary><LoadMap forecast={forecast} series={series} /></MapErrorBoundary>
              : value === 'table' ? <ForecastTable forecast={forecast} series={series} />
                : value === 'planning' ? <PlanningTab forecast={forecast} series={series} />
                  : <ModelTab health={health} />}
        </Tabs.Panel>
      ))}
    </Tabs>
  );
}
