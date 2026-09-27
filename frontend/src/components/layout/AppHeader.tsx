import { Burger, Group, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconTrain } from '@tabler/icons-react';
import type { HealthReady } from '../../api/types';
import { daysInclusive } from '../../domain/dates';
import { formatDays, formatIsoDate } from '../../domain/format';
import { useUiStore } from '../../state/store';
import classes from './layout.module.css';
import { SnapshotBadge } from './SnapshotBadge';
import { ThemeToggle } from './ThemeToggle';

interface AppHeaderProps {
  health: HealthReady;
}

export function AppHeader({ health }: AppHeaderProps) {
  const panelOpen = useUiStore((state) => state.panelOpen);
  const togglePanel = useUiStore((state) => state.togglePanel);
  const { start, end } = health.coverage;
  const period = `${formatIsoDate(start)} — ${formatIsoDate(end)}`;

  return (
    <Group h="100%" px="md" gap="sm" wrap="nowrap" justify="space-between">
      <Group gap="sm" wrap="nowrap" miw={0}>
        <Burger
          className={classes.burger}
          opened={panelOpen}
          onClick={togglePanel}
          size="sm"
          aria-label={panelOpen ? 'Скрыть панель фильтров' : 'Показать панель фильтров'}
          aria-expanded={panelOpen}
          aria-controls="filters-panel"
        />
        <ThemeIcon size={36} radius="md" variant="light" aria-hidden visibleFrom="sm">
          <IconTrain size={22} stroke={1.7} />
        </ThemeIcon>
        <Stack gap={0} miw={0}>
          <Title order={1} size="h4" lh={1.2} className={classes.title}>
            Прогноз пассажиропотока трамваев
          </Title>
          <Text size="xs" c="dimmed" visibleFrom="md" className={classes.nowrap}>
            Москва · 10 маршрутов · посадки по часам
          </Text>
          {/* Ниже 992 px покрытие — под заголовком, на телефоне — только в раскрытии бейджа вместе с версией. */}
          <Text size="xs" c="dimmed" hiddenFrom="md" className={classes.coverageCompact}>
            Покрытие: {period}
          </Text>
        </Stack>
      </Group>

      <Group gap="md" wrap="nowrap">
        <Stack gap={0} align="flex-end" visibleFrom="md">
          <Text size="sm" className={classes.nowrap}>
            <Text span c="dimmed" inherit>
              Покрытие:{' '}
            </Text>
            {period}
            <Text span c="dimmed" inherit>
              {' '}
              · {formatDays(daysInclusive(start, end))}
            </Text>
          </Text>
          <Text size="xs" c="dimmed" ff="monospace" className={classes.version} title={health.forecast_version}>
            Версия: {health.forecast_version}
          </Text>
        </Stack>
        <SnapshotBadge health={health} />
        <ThemeToggle />
      </Group>
    </Group>
  );
}
