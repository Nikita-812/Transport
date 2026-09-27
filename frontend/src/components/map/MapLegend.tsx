import { Group, Stack, Text } from '@mantine/core';
import { memo } from 'react';
import type { RouteId } from '../../api/types';
import { LOAD_SCALE } from '../../data/route-colors';
import { formatLoadRange, legendRanges, type LoadScale } from '../../domain/mapLoad';
import classes from './map.module.css';
import { NO_DATA_COLOR } from './paint';

const LIST_STYLE = { listStyle: 'none', margin: 0, padding: 0 } as const;

/** Легенда 5 классов с границами в посадках в час (spec route-load-map «Load coloring»). */
export const MapLegend = memo(function MapLegend({ scale, caption, missing }: {
  scale: LoadScale | null;
  /** Что показывают значения: дата или «в среднем за день». */
  caption: string;
  /** Выбранные маршруты без данных — серые линии. */
  missing: readonly RouteId[];
}) {
  return (
    <Stack gap={6}>
      <Group gap="xs" justify="space-between" wrap="wrap">
        <Text size="sm" fw={600}>Нагрузка, посадок в час</Text>
        <Text size="xs" c="dimmed">{caption}</Text>
      </Group>
      {scale ? (
        <Group component="ul" gap="md" wrap="wrap" style={LIST_STYLE} aria-label="Классы нагрузки">
          {legendRanges(scale).map((range, index) => (
            <Group component="li" key={index} gap={6} wrap="nowrap">
              <span className={classes.swatch} style={{ background: LOAD_SCALE[index] }} aria-hidden />
              <Text size="xs" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatLoadRange(range)}</Text>
            </Group>
          ))}
          {missing.length > 0 && (
            <Group component="li" gap={6} wrap="nowrap">
              <span className={classes.swatch} style={{ background: NO_DATA_COLOR }} aria-hidden />
              <Text size="xs">нет данных: {missing.join(', ')}</Text>
            </Group>
          )}
        </Group>
      ) : (
        <Text size="xs" c="dimmed">Классы появятся, когда загрузится прогноз выбранных маршрутов.</Text>
      )}
      <Text size="xs" c="dimmed">
        Классы — квантили всех значений «маршрут × час» выбранных маршрутов после сценария, поэтому ночью линии
        уходят в нижние классы. Толщина линии растёт как √ нагрузки.
      </Text>
    </Stack>
  );
});
