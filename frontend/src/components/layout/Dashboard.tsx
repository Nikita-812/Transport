import { Alert, AppShell, Text } from '@mantine/core';
import { useReadyHealth } from '../../hooks/useHealth';
import { useUiStore } from '../../state/store';
import { AppHeader } from './AppHeader';
import { DashboardTabs } from './DashboardTabs';
import { SidePanel } from './SidePanel';
import { useDashboardState } from '../../hooks/useDashboardState';
import { useForecastSeries } from '../../hooks/useForecastSeries';
import { LoadingScreen } from '../common/LoadingScreen';

/** Раскладка дашборда: шапка, левая панель (выдвижная ниже 1024 px) и вкладки. */
export function Dashboard() {
  const health = useReadyHealth();
  const panelOpen = useUiStore((state) => state.panelOpen);
  const filters = useUiStore((state) => state.filters);
  const warnings = useUiStore((state) => state.urlWarnings);
  const ready = useDashboardState(health);
  const forecast = useForecastSeries(health.forecast_version, ready && filters ? filters.routes : [], filters ?? health.coverage);
  if (!ready) return <LoadingScreen />;

  return (
    <AppShell
      header={{ height: 64 }}
      navbar={{ width: { base: 300, xl: 340 }, breakpoint: '64em', collapsed: { mobile: !panelOpen } }}
      padding="md"
    >
      <AppShell.Header>
        <AppHeader health={health} />
      </AppShell.Header>
      <AppShell.Navbar id="filters-panel" aria-label="Фильтры и сценарий">
        <SidePanel />
      </AppShell.Navbar>
      <AppShell.Main>
        {warnings.length > 0 && <Alert mb="md" color="yellow" title="Параметры ссылки исправлены" withCloseButton closeButtonLabel="Закрыть уведомление" onClose={() => useUiStore.getState().dismissWarnings()}>
          {warnings.map((message, index) => <Text size="sm" key={index}>{message}</Text>)}
        </Alert>}
        <DashboardTabs forecast={forecast} />
      </AppShell.Main>
    </AppShell>
  );
}
