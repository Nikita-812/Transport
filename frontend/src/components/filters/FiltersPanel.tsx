import { Alert, Button, Chip, Group, NativeSelect, Stack, Text, Title } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { isIsoDate, ROUTES } from '../../api/types';
import { ROUTE_COLORS } from '../../data/route-colors';
import { hourLabel } from '../../domain/aggregate';
import { daysInclusive } from '../../domain/dates';
import { formatDays, formatIsoDate } from '../../domain/format';
import { resolveRange, type Granularity, type Horizon } from '../../domain/horizon';
import { useUiStore } from '../../state/store';

function parseInput(value: string): string | null {
  const parts = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
  const iso = parts ? `${parts[3]}-${parts[2]}-${parts[1]}` : value;
  return isIsoDate(iso) ? iso : null;
}

export function FiltersPanel() {
  const state = useUiStore();
  const { filters, coverage } = state;
  if (!filters || !coverage) return null;
  const range = resolveRange(filters.horizon, filters.start, filters.end, coverage);
  const dateProps = {
    minDate: coverage.start, maxDate: coverage.end, valueFormat: 'DD.MM.YYYY', dateParser: parseInput,
    previousLabel: 'Предыдущий месяц', nextLabel: 'Следующий месяц',
    onBlur: (event: React.FocusEvent<HTMLInputElement>) => {
      const value = parseInput(event.currentTarget.value);
      if (!value || value < coverage.start || value > coverage.end) state.setValidationError(`Введите дату с ${formatIsoDate(coverage.start)} по ${formatIsoDate(coverage.end)}.`);
    },
  };
  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={2} size="h6">Маршруты</Title>
        <Group gap={4}>
          <Button size="compact-xs" variant="subtle" onClick={() => state.setRoutes([...ROUTES])}>Все</Button>
          <Button size="compact-xs" variant="subtle" color="gray" onClick={() => state.setRoutes([])}>Снять выбор</Button>
        </Group>
      </Group>
      <Group gap={6} aria-label="Маршруты">
        {ROUTES.map((route) => (
          <Chip key={route} checked={filters.routes.includes(route)} color={ROUTE_COLORS[route]} variant="filled" autoContrast
            aria-label={`Маршрут ${route}`} onChange={(checked) => state.setRoutes(checked ? [...filters.routes, route] : filters.routes.filter((r) => r !== route))}>
            {route}
          </Chip>
        ))}
      </Group>
      {filters.routes.length === 0 && <Text size="sm" c="dimmed">Выберите хотя бы один маршрут</Text>}
      <Group justify="space-between">
        <Title order={2} size="h6">Период и часы</Title>
        <Button size="compact-sm" variant={state.nowMode ? 'filled' : 'light'} onClick={state.goNow}>Сейчас</Button>
      </Group>
      {state.nowMode && <Text size="xs" c="dimmed">Москва · {hourLabel(state.mapHour)} · режим «Сейчас»</Text>}
      {state.nowOutside && <Alert color="blue" title="Сегодня вне периода прогноза">Открыт первый день покрытия: {formatIsoDate(coverage.start)}.</Alert>}
      <NativeSelect label="Горизонт" value={filters.horizon} onChange={(event) => state.setHorizon(event.currentTarget.value as Horizon)}
        data={[{ value: 'day', label: 'День' }, { value: 'month', label: 'Месяц' }, { value: 'year', label: 'Год' }, { value: 'period', label: 'Период' }]} />
      <DateInput {...dateProps} label={filters.horizon === 'day' ? 'Дата' : 'Дата начала'} value={filters.start}
        onChange={(value) => value && state.setDates(value, filters.horizon === 'period' && value > filters.end ? value : filters.end)} />
      {filters.horizon === 'period' && <DateInput {...dateProps} label="Дата окончания" value={filters.end}
        onChange={(value) => value && state.setDates(filters.start, value)} />}
      <Text size="sm" c="dimmed">{formatIsoDate(filters.start)} — {formatIsoDate(filters.end)} · {formatDays(daysInclusive(filters.start, filters.end))}</Text>
      {range.clipped && <Alert color="blue" title="Горизонт обрезан покрытием">Снимок покрывает {formatDays(daysInclusive(coverage.start, coverage.end))}. Данные показаны до {formatIsoDate(filters.end)}.</Alert>}
      <Group grow align="start">
        <NativeSelect label="Часы с" value={filters.hours.from} onChange={(event) => state.setHours({ ...filters.hours, from: Number(event.currentTarget.value) })}
          data={Array.from({ length: 24 }, (_, hour) => ({ value: String(hour), label: hourLabel(hour) }))} />
        <NativeSelect label="Часы по" value={filters.hours.to} onChange={(event) => state.setHours({ ...filters.hours, to: Number(event.currentTarget.value) })}
          data={Array.from({ length: 24 }, (_, hour) => ({ value: String(hour), label: hourLabel(hour) }))} />
      </Group>
      <Text size="xs" c="dimmed">Оба часа включаются в расчёт.</Text>
      {state.validationError && <Alert color="red" title="Проверьте фильтры" withCloseButton closeButtonLabel="Закрыть ошибку" onClose={() => state.setValidationError(null)}>{state.validationError}</Alert>}
      <NativeSelect label="Детализация" value={filters.granularity} onChange={(event) => state.setGranularity(event.currentTarget.value as Granularity)}
        data={[{ value: 'hour', label: 'Час' }, { value: 'day', label: 'День' }, { value: 'week', label: 'ISO-неделя' }, { value: 'month', label: 'Месяц' }]} />
      <NativeSelect label="Разрез" value={filters.split} onChange={(event) => state.setSplit(event.currentTarget.value as 'routes' | 'total')}
        data={[{ value: 'routes', label: 'По маршрутам' }, { value: 'total', label: 'Итог' }]} />
    </Stack>
  );
}
