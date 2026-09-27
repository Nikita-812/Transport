import { Anchor, Badge, Button, Group, Pagination, Paper, Stack, Table, Text, Title } from '@mantine/core';
import { IconDownload, IconExternalLink } from '@tabler/icons-react';
import { useMemo, useState } from 'react';
import { submissionCsvUrl } from '../../api/client';
import { ROUTE_COLORS } from '../../data/route-colors';
import { aggregate, viewRows, type ViewRow } from '../../domain/aggregate';
import { buildCsv, csvFileName } from '../../domain/csv';
import { formatBucketTitle, formatDecimal, formatInteger } from '../../domain/format';
import type { Granularity } from '../../domain/horizon';
import type { ForecastResults } from '../../hooks/useForecastSeries';
import type { ScenarioSeriesResult } from '../../hooks/useScenarioSeries';
import { useUiStore } from '../../state/store';
import { ForecastStatus } from '../common/ForecastStatus';

const PAGE_SIZE = 50;

const GRANULARITY_NAMES = { hour: 'Час', day: 'День', week: 'ISO-неделя', month: 'Месяц' } as const;

function totalsOf(rows: readonly ViewRow[]) {
  const base = rows.reduce((sum, row) => sum + row.base, 0);
  const prediction = rows.reduce((sum, row) => sum + row.prediction, 0);
  return { base, prediction, coefficient: base === 0 ? 1 : prediction / base };
}

/**
 * Страницы таблицы. Компонент монтируется заново при смене вида (`key`), поэтому номер страницы
 * сбрасывается без эффекта и каскадного повторного рендера.
 */
function PagedRows({ rows, granularity, byRoute }: { rows: readonly ViewRow[]; granularity: Granularity; byRoute: boolean }) {
  const [page, setPage] = useState(1);
  const totals = useMemo(() => totalsOf(rows), [rows]);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const from = (current - 1) * PAGE_SIZE;
  const visible = rows.slice(from, from + PAGE_SIZE);

  return (
    <>
      <Paper withBorder radius="lg">
        <Table.ScrollContainer minWidth={520} type="native">
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{GRANULARITY_NAMES[granularity]}</Table.Th>
                {byRoute && <Table.Th>Маршрут</Table.Th>}
                <Table.Th ta="right">База</Table.Th>
                <Table.Th ta="right">Коэффициент</Table.Th>
                <Table.Th ta="right">Прогноз</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {visible.map((row) => (
                <Table.Tr key={`${row.route ?? 'all'}:${row.key}`}>
                  <Table.Td>{formatBucketTitle(row.key, granularity)}</Table.Td>
                  {byRoute && (
                    <Table.Td>
                      {row.route !== null && <Badge variant="light" autoContrast color={ROUTE_COLORS[row.route]}>{row.route}</Badge>}
                    </Table.Td>
                  )}
                  <Table.Td ta="right">{formatInteger(row.base)}</Table.Td>
                  <Table.Td ta="right">{formatDecimal(row.coefficient, 3)}</Table.Td>
                  <Table.Td ta="right" fw={600}>{formatInteger(row.prediction)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
            <Table.Tfoot>
              <Table.Tr aria-label="Итого">
                <Table.Th>Итого</Table.Th>
                {byRoute && <Table.Th />}
                <Table.Th ta="right">{formatInteger(totals.base)}</Table.Th>
                <Table.Th ta="right">{formatDecimal(totals.coefficient, 3)}</Table.Th>
                <Table.Th ta="right">{formatInteger(totals.prediction)}</Table.Th>
              </Table.Tr>
            </Table.Tfoot>
          </Table>
        </Table.ScrollContainer>
      </Paper>
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          Строки {formatInteger(from + 1)}–{formatInteger(from + visible.length)} из {formatInteger(rows.length)}
        </Text>
        {pageCount > 1 && (
          <Pagination total={pageCount} value={current} onChange={setPage} size="sm" withEdges
            getItemProps={(item) => ({ 'aria-label': `Страница ${item}` })} />
        )}
      </Group>
    </>
  );
}

/** Скачивание без сервера: файл собирается в браузере из текущего вида. */
function downloadCsv(fileName: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Вкладка «Таблица»: строки текущей детализации, итог и выгрузка текущего вида в CSV. */
export function ForecastTable({ forecast, series }: { forecast: ForecastResults; series: ScenarioSeriesResult }) {
  const filters = useUiStore((state) => state.filters);
  const coverage = useUiStore((state) => state.coverage);
  const byRoute = filters?.split === 'routes';
  const granularity = filters?.granularity ?? 'day';
  const hours = filters?.hours;
  const rows = useMemo(
    () => (hours ? viewRows(
      aggregate(series.base, granularity, hours, byRoute),
      aggregate(series.adjusted, granularity, hours, byRoute),
    ) : []),
    [series.base, series.adjusted, granularity, hours, byRoute],
  );
  if (!filters || !coverage) return null;

  const fileName = csvFileName(filters.horizon, filters.start, filters.end);
  const viewKey = [granularity, filters.split, filters.start, filters.end, filters.hours.from, filters.hours.to,
    series.base.map((item) => item.route).join('.'), series.active].join(':');

  return (
    <Stack gap="md" mt="lg">
      <Group justify="space-between" align="flex-end">
        <Stack gap={2}>
          <Title order={2} size="h3">Таблица прогноза</Title>
          <Text size="sm" c="dimmed">
            Детализация: {GRANULARITY_NAMES[granularity].toLowerCase()} · {byRoute ? 'по маршрутам' : 'итог по выбранным маршрутам'} ·
            {' '}часы {filters.hours.from}–{filters.hours.to} · строк: {formatInteger(rows.length)}
          </Text>
        </Stack>
        <Button
          leftSection={<IconDownload size={16} aria-hidden />}
          disabled={rows.length === 0}
          onClick={() => { downloadCsv(fileName, buildCsv(rows, { granularity, byRoute })); }}
        >
          Скачать CSV
        </Button>
      </Group>
      <ForecastStatus forecast={forecast} routes={filters.routes} coverage={coverage} />
      {rows.length > 0 && <PagedRows key={viewKey} rows={rows} granularity={granularity} byRoute={byRoute} />}
      <Text size="sm" c="dimmed">
        Файл «{fileName}» повторяет таблицу: UTF-8 с BOM, разделитель «;», точка в дробной части, прогнозы с тремя знаками
        после точки, коэффициент с четырьмя. Полный прогноз сервиса за период submission — файл{' '}
        <Anchor href={submissionCsvUrl()} download>
          /forecasts.csv <IconExternalLink size={13} aria-hidden />
        </Anchor>
        {' '}без фильтров, диапазона часов и коэффициентов.
      </Text>
    </Stack>
  );
}
