import { Paper, SimpleGrid, Stack, Text } from '@mantine/core';
import { hourLabel, type Kpis } from '../../domain/aggregate';
import { formatInteger, formatIsoDate } from '../../domain/format';

export function KpiCards({ kpis }: { kpis: Kpis }) {
  const cards = [
    { label: 'Всего посадок', value: formatInteger(kpis.total), detail: 'За выбранные даты и часы' },
    { label: 'Пиковый час', value: kpis.peak ? formatInteger(kpis.peak.prediction) : '—', detail: kpis.peak ? `${formatIsoDate(kpis.peak.date)} · ${hourLabel(kpis.peak.hour)}` : 'Нет данных' },
    { label: 'Самый загруженный маршрут', value: kpis.busiestRoute ? `№ ${kpis.busiestRoute.route}` : '—', detail: kpis.busiestRoute ? `${formatInteger(kpis.busiestRoute.prediction)} посадок` : 'Нет данных' },
    { label: 'В среднем за час', value: formatInteger(kpis.averagePerHour), detail: 'Сумма выбранных маршрутов' },
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
