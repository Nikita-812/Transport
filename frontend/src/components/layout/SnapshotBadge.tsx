import { Anchor, Badge, Group, Popover, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import type { HealthReady } from '../../api/types';
import { daysInclusive } from '../../domain/dates';
import { formatDays, formatIsoDate } from '../../domain/format';
import { useUiStore } from '../../state/store';
import classes from './layout.module.css';

interface SnapshotBadgeProps {
  health: HealthReady;
}

/**
 * Нейтральный бейдж статуса снимка (design D13). Диагностический режим — не ошибка сервиса,
 * поэтому бейдж серый, без предупреждающих цветов. Полное раскрытие со сведениями о модели — раздел 7.
 */
export function SnapshotBadge({ health }: SnapshotBadgeProps) {
  const setTab = useUiStore((state) => state.setTab);
  const diagnostic = health.serving_mode === 'diagnostic';
  const label = diagnostic ? 'Диагностический снимок' : 'Рабочий снимок';
  const model = health.forecast_version.split(':')[0] ?? health.forecast_version;
  const { start, end } = health.coverage;

  return (
    <Popover width={340} position="bottom-end" withArrow shadow="md">
      <Popover.Target>
        <UnstyledButton aria-label={`${label}: подробнее о снимке прогноза`} style={{ borderRadius: 'var(--mantine-radius-xl)' }}>
          <Badge variant="light" color="gray" size="lg" radius="xl" classNames={{ root: classes.snapshotBadge, label: classes.snapshotBadgeLabel, section: classes.snapshotBadgeSection }} leftSection={<IconInfoCircle size={14} aria-hidden />}>
            {label}
          </Badge>
        </UnstyledButton>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs">
          <Text fw={600}>{label}</Text>
          {diagnostic ? (
            <Text size="sm">
              Снимок не прошёл внутренний порог качества команды: WAPE-score не ниже 0,95 на каждом срезе проверки. Этот
              порог строже шкалы жюри, где максимальный балл дают за WAPE-score выше 0,88. Это не ошибка сервиса: прогноз
              доступен полностью.
            </Text>
          ) : (
            <Text size="sm">
              {health.quality_passed
                ? 'Снимок прошёл внутренний порог качества команды: WAPE-score не ниже 0,95 на каждом срезе проверки.'
                : 'Снимок опубликован в рабочем режиме.'}
            </Text>
          )}
          <Stack gap={2}>
            <Group gap={6} wrap="nowrap" align="baseline">
              <Text size="sm" c="dimmed" miw={78}>
                Модель
              </Text>
              <Text size="sm" ff="monospace" style={{ wordBreak: 'break-all' }}>
                {model}
              </Text>
            </Group>
            <Group gap={6} wrap="nowrap" align="baseline">
              <Text size="sm" c="dimmed" miw={78}>
                Версия
              </Text>
              <Text size="sm" ff="monospace" style={{ wordBreak: 'break-all' }}>
                {health.forecast_version}
              </Text>
            </Group>
            <Group gap={6} wrap="nowrap" align="baseline">
              <Text size="sm" c="dimmed" miw={78}>
                Покрытие
              </Text>
              <Text size="sm">
                {formatIsoDate(start)} — {formatIsoDate(end)} ({formatDays(daysInclusive(start, end))})
              </Text>
            </Group>
          </Stack>
          <Anchor component="button" type="button" size="sm" ta="left" onClick={() => setTab('model')}>
            Подробнее о модели
          </Anchor>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
