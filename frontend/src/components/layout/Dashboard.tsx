import { AppShell } from '@mantine/core';
import { useReadyHealth } from '../../hooks/useHealth';
import { useUiStore } from '../../state/store';
import { AppHeader } from './AppHeader';
import { DashboardTabs } from './DashboardTabs';
import { SidePanel } from './SidePanel';

/** Раскладка дашборда: шапка, левая панель (выдвижная ниже 1024 px) и вкладки. */
export function Dashboard() {
  const health = useReadyHealth();
  const panelOpen = useUiStore((state) => state.panelOpen);

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
        <DashboardTabs />
      </AppShell.Main>
    </AppShell>
  );
}
