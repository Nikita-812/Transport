import { Paper, SimpleGrid, Stack, Text } from '@mantine/core';
import { hourLabel, type Kpis } from '../../domain/aggregate';
import { formatInteger, formatIsoDate } from '../../domain/format';

const percentFormat = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero' });

function delta(value: number, base: number): string {
  return `${percentFormat.format(base === 0 ? 0 : ((value - base) / base) * 100)} %`;
}

export function KpiCards({ kpis, baseKpis = kpis }: { kpis: Kpis; baseKpis?: Kpis }) {
  const cards = [
    {
      label: 'Всего посадок', value: formatInteger(kpis.total),
      detail: `База: ${formatInteger(baseKpis.total)} · Δ ${delta(kpis.total, baseKpis.total)}`,
    },
    {
      label: 'Пиковый час', value: kpis.peak ? formatInteger(kpis.peak.prediction) : '—',
      detail: kpis.peak && baseKpis.peak
        ? `${formatIsoDate(kpis.peak.date)} · ${hourLabel(kpis.peak.hour)} · база: ${formatInteger(baseKpis.peak.prediction)} · Δ ${delta(kpis.peak.prediction, baseKpis.peak.prediction)}`
        : 'Нет данных',
    },
    {
      label: 'Самый загруженный маршрут', value: kpis.busiestRoute ? `№ ${kpis.busiestRoute.route}` : '—',
      detail: kpis.busiestRoute && baseKpis.busiestRoute
        ? `Прогноз: ${formatInteger(kpis.busiestRoute.prediction)} · база: № ${baseKpis.busiestRoute.route}, ${formatInteger(baseKpis.busiestRoute.prediction)} · Δ ${delta(kpis.busiestRoute.prediction, baseKpis.busiestRoute.prediction)}`
        : 'Нет данных',
    },
    {
      label: 'В среднем за час', value: formatInteger(kpis.averagePerHour),
      detail: `База: ${formatInteger(baseKpis.averagePerHour)} · Δ ${delta(kpis.averagePerHour, baseKpis.averagePerHour)}`,
    },
  ];
  return (
    <SimpleGrid cols={{ base: 1, sm: 2, xl: 4 }} spacing="md" aria-label="Ключевые показатели">
      {cards.map(({ label, value, detail }) => (
        <Paper key={label} withBorder radius="lg" p="lg" component="section" aria-label={label}>
          <Stack gap={6}>
            <Text size="sm" c="dimmed">{label}</Text>
            <Text size="1.8rem" fw={700} lh={1.2}>{value}</Text>
            <Text size="xs" c="dimmed">{detail}</Text>
          </Stack>
        </Paper>
      ))}
    </SimpleGrid>
  );
}
