import { Alert, Badge, NumberInput, Paper, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import { useMemo } from 'react';
import { ROUTE_COLORS } from '../../data/route-colors';
import { ALL_HOURS, hourLabel } from '../../domain/aggregate';
import { daysInclusive, weekday } from '../../domain/dates';
import { formatDays, formatDecimal, formatInteger, formatIsoDate, formatWeekdayLong } from '../../domain/format';
import { planningRows, type PlanningAssumptions } from '../../domain/planning';
import type { ForecastResults } from '../../hooks/useForecastSeries';
import type { ScenarioSeriesResult } from '../../hooks/useScenarioSeries';
import { useUiStore } from '../../state/store';
import type { Filters } from '../../state/url';
import { ForecastStatus } from '../common/ForecastStatus';

export const NO_DEMAND = 'Нет потребности';

/** Поля допущений в единицах ввода: заполнение задаётся процентами, доля s — числом от 0 до 1. */
const LIMITS = {
  capacity: { min: 1, max: 1000, step: 10 },
  fillPercent: { min: 1, max: 100, step: 5 },
  share: { min: 0.01, max: 1, step: 0.05 },
} as const;

/** Один день — прогноз этой даты, период — средний день (та же семантика, что на карте). */
function describeDay(filters: Filters): string {
  if (filters.start === filters.end) {
    return `прогноз на ${formatIsoDate(filters.start)}, ${formatWeekdayLong(weekday(filters.start)).toLowerCase()}`;
  }
  const days = formatDays(daysInclusive(filters.start, filters.end));
  return `средний день периода ${formatIsoDate(filters.start)} — ${formatIsoDate(filters.end)} (${days})`;
}

function Assumptions({ value, onChange }: { value: PlanningAssumptions; onChange: (next: PlanningAssumptions) => void }) {
  return (
    <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
      <NumberInput
        label="Вместимость вагона (C)"
        description="Пассажиров в вагоне"
        suffix=" пасс."
        value={value.capacity}
        onChange={(next) => typeof next === 'number' && onChange({ ...value, capacity: next })}
        min={LIMITS.capacity.min}
        max={LIMITS.capacity.max}
        step={LIMITS.capacity.step}
        decimalScale={0}
        clampBehavior="strict"
      />
      <NumberInput
        label="Целевое заполнение (f)"
        description="Доля вместимости, которую планируем занимать"
        suffix=" %"
        value={Math.round(value.fill * 100)}
        onChange={(next) => typeof next === 'number' && onChange({ ...value, fill: next / 100 })}
        min={LIMITS.fillPercent.min}
        max={LIMITS.fillPercent.max}
        step={LIMITS.fillPercent.step}
        decimalScale={0}
        clampBehavior="strict"
      />
      <NumberInput
        label="Доля одновременно едущих (s)"
        description="Часть посадок часа, едущих на самом загруженном перегоне"
        value={value.share}
        onChange={(next) => typeof next === 'number' && onChange({ ...value, share: next })}
        min={LIMITS.share.min}
        max={LIMITS.share.max}
        step={LIMITS.share.step}
        decimalScale={2}
        decimalSeparator=","
        clampBehavior="strict"
      />
    </SimpleGrid>
  );
}

/**
 * Вкладка «Выпуск и расписание»: пиковый час каждого маршрута после сценария переводится в
 * требуемые рейсы и интервал. Модель считает посадки, а не наполнение вагона, поэтому C, f и s —
 * редактируемые допущения диспетчера, а не результат обучения.
 */
export function PlanningTab({ forecast, series }: { forecast: ForecastResults; series: ScenarioSeriesResult }) {
  const filters = useUiStore((state) => state.filters);
  const coverage = useUiStore((state) => state.coverage);
  const assumptions = useUiStore((state) => state.planning);
  const setAssumptions = useUiStore((state) => state.setPlanningAssumptions);
  const hours = filters?.hours ?? ALL_HOURS;
  const rows = useMemo(() => planningRows(series.adjusted, hours, assumptions), [series.adjusted, hours, assumptions]);
  if (!filters || !coverage) return null;

  const seats = assumptions.capacity * assumptions.fill;

  return (
    <Stack gap="md" mt="lg">
      <div>
        <Title order={2} size="h3">Выпуск и расписание</Title>
        <Text size="sm" c="dimmed">
          Пиковый час каждого маршрута: {describeDay(filters)}, часы {hourLabel(hours.from)}–{hourLabel(hours.to)}
          {series.active ? ', значения после сценария' : ''}.
        </Text>
      </div>
      <ForecastStatus forecast={forecast} routes={filters.routes} coverage={coverage} />
      <Alert color="gray" variant="light" icon={<IconInfoCircle size={18} aria-hidden />} title="Оценка, а не расписание">
        <Stack gap={4}>
          <Text size="sm">
            Посадки в час — это не наполнение вагона: пассажиры входят и выходят на всём маршруте. Сколько их едет
            одновременно на самом загруженном перегоне, модель не знает.
          </Text>
          <Text size="sm">
            Поэтому s, C и f — допущения, а не данные прогноза. Их нужно калибровать по обследованиям пассажиропотока:
            замерам наполнения, телематике и данным о вместимости подвижного состава на конкретном маршруте.
          </Text>
        </Stack>
      </Alert>
      <Paper withBorder radius="lg" p="md">
        <Stack gap="sm">
          <Title order={3} size="h5">Допущения выпуска</Title>
          <Assumptions value={assumptions} onChange={setAssumptions} />
          <Text size="sm" c="dimmed">
            Рейсы в час = ⌈B × s / (C × f)⌉, интервал = ⌊60 / рейсы⌋ мин. Сейчас: C × f = {formatInteger(assumptions.capacity)} ×
            {' '}{formatDecimal(assumptions.fill, 2)} = {formatInteger(seats)} мест в вагоне, s = {formatDecimal(assumptions.share, 2)}.
            B — посадки маршрута в пиковый час.
          </Text>
        </Stack>
      </Paper>
      {rows.length > 0 && (
        <Paper withBorder radius="lg">
          <Table.ScrollContainer minWidth={520} type="native">
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Маршрут</Table.Th>
                  <Table.Th>Пиковый час</Table.Th>
                  <Table.Th ta="right">Посадки в час (B)</Table.Th>
                  <Table.Th ta="right">Рейсы в час</Table.Th>
                  <Table.Th ta="right">Интервал</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((row) => (
                  <Table.Tr key={row.route}>
                    <Table.Td>
                      <Badge variant="light" autoContrast color={ROUTE_COLORS[row.route]}>{row.route}</Badge>
                    </Table.Td>
                    <Table.Td>{row.hour === null ? '—' : hourLabel(row.hour)}</Table.Td>
                    <Table.Td ta="right">{formatInteger(row.boardings)}</Table.Td>
                    <Table.Td ta="right" fw={600}>
                      {row.trips > 0 ? formatInteger(row.trips) : <Text size="sm" c="dimmed" component="span">{NO_DEMAND}</Text>}
                    </Table.Td>
                    <Table.Td ta="right">{row.headway === null ? '—' : `${formatInteger(row.headway)} мин`}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      )}
      <Text size="xs" c="dimmed">
        Рейсы округляются вверх до целого, интервал — вниз до целой минуты: и то и другое в пользу пассажира.
        Пиковые часы маршрутов могут не совпадать, поэтому строки нельзя складывать в общий выпуск по сети.
      </Text>
    </Stack>
  );
}
