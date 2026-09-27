import { Box, Button, Group, Slider, Text } from '@mantine/core';
import { IconClockHour4, IconPlayerPauseFilled, IconPlayerPlayFilled } from '@tabler/icons-react';
import { hourLabel, type HourRange } from '../../domain/aggregate';

interface HourControlsProps {
  hour: number;
  /** Диапазон часов фильтра: ползунок и проигрывание не выходят за него. */
  hours: HourRange;
  playing: boolean;
  nowMode: boolean;
  onHourChange: (hour: number) => void;
  onTogglePlay: () => void;
  onNow: () => void;
}

const MARKS = [0, 6, 12, 18, 23].map((mark) => ({ value: mark, label: String(mark).padStart(2, '0') }));

/** Ползунок часа 0–23, проигрывание суток и «Сейчас» (spec route-load-map «Hour playback»). */
export function HourControls({ hour, hours, playing, nowMode, onHourChange, onTogglePlay, onNow }: HourControlsProps) {
  const single = hours.from === hours.to;
  return (
    <Group gap="md" wrap="wrap" align="center">
      <Button
        size="sm"
        variant={playing ? 'filled' : 'light'}
        leftSection={playing ? <IconPlayerPauseFilled size={16} aria-hidden /> : <IconPlayerPlayFilled size={16} aria-hidden />}
        onClick={onTogglePlay}
        disabled={single}
        aria-pressed={playing}
        w={132}
      >
        {playing ? 'Пауза' : 'Проиграть'}
      </Button>
      <Box flex="1 1 240px" miw={200} pb="md">
        {/* Шкала всегда 0–23, выбрать можно только часы из диапазона фильтра. */}
        <Slider
          min={0}
          max={23}
          domain={[hours.from, hours.to]}
          step={1}
          value={hour}
          onChange={onHourChange}
          label={hourLabel}
          marks={MARKS}
          thumbLabel="Час карты"
          thumbProps={{ 'aria-valuetext': hourLabel(hour) }}
        />
      </Box>
      <Text fw={700} fz="lg" miw={56} ta="center" style={{ fontVariantNumeric: 'tabular-nums' }}>{hourLabel(hour)}</Text>
      <Button size="sm" variant={nowMode ? 'filled' : 'default'} leftSection={<IconClockHour4 size={16} aria-hidden />} onClick={onNow}>
        Сейчас
      </Button>
    </Group>
  );
}
