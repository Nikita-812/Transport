import { Paper, ScrollArea, Stack, Tabs, Text, ThemeIcon, Title } from '@mantine/core';
import { IconCalendarTime, IconInfoCircle, IconLayoutDashboard, IconMap, IconTable, type Icon } from '@tabler/icons-react';
import { isTabId, TABS, useUiStore, type TabId } from '../../state/store';
import classes from './layout.module.css';

const TAB_META: Record<TabId, { icon: Icon; placeholder: string }> = {
  overview: { icon: IconLayoutDashboard, placeholder: 'Ключевые показатели, график динамики, тепловая карта «день недели × час» и рейтинг маршрутов.' },
  map: { icon: IconMap, placeholder: 'Карта Москвы: линии маршрутов по прогнозной нагрузке, проигрывание суток, остановки и участки.' },
  table: { icon: IconTable, placeholder: 'Таблица прогноза текущей детализации с сортировкой, итогом и выгрузкой в CSV.' },
  planning: { icon: IconCalendarTime, placeholder: 'Требуемые рейсы и интервалы движения по прогнозу при редактируемых допущениях.' },
  model: { icon: IconInfoCircle, placeholder: 'Модель и снимок, качество на проверке, область применимости, источники данных и ограничения.' },
};

function Placeholder({ tab }: { tab: TabId }) {
  const { icon: TabIcon, placeholder } = TAB_META[tab];
  const label = TABS.find((item) => item.value === tab)?.label ?? '';
  return (
    <Paper withBorder radius="lg" p="xl" mt="md">
      <Stack align="center" gap="sm" ta="center" py="xl">
        <ThemeIcon size={48} radius="xl" variant="light" color="gray" aria-hidden>
          <TabIcon size={26} stroke={1.6} />
        </ThemeIcon>
        <Title order={2} size="h3">
          {label}
        </Title>
        <Text c="dimmed" maw={520}>
          {placeholder}
        </Text>
        <Text size="sm" c="dimmed" fs="italic">
          Раздел в разработке.
        </Text>
      </Stack>
    </Paper>
  );
}

export function DashboardTabs() {
  const tab = useUiStore((state) => state.tab);
  const setTab = useUiStore((state) => state.setTab);

  return (
    <Tabs value={tab} onChange={(value) => isTabId(value) && setTab(value)} keepMounted={false}>
      <ScrollArea type="auto" scrollbarSize={4} offsetScrollbars="x">
        <Tabs.List className={classes.tabsList} aria-label="Разделы дашборда">
          {TABS.map(({ value, label }) => {
            const TabIcon = TAB_META[value].icon;
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
          <Placeholder tab={value} />
        </Tabs.Panel>
      ))}
    </Tabs>
  );
}
