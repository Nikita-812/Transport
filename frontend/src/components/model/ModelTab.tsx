import { Alert, Anchor, Badge, Code, Group, List, Paper, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { IconExternalLink, IconInfoCircle } from '@tabler/icons-react';
import type { HealthReady } from '../../api/types';
import { OSM_ROUTES } from '../../data/osm-routes';
import {
  ADAPTATION, APPLICABILITY, LIMITATIONS, modelFacts, modelName, NOT_INCLUDED, NOT_INCLUDED_SOURCE,
  QUALITY, QUALITY_GATE, README_URL, ROADMAP, SOURCES, type ModelFacts,
} from '../../data/model-info';
import { daysInclusive } from '../../domain/dates';
import { formatDays, formatDecimal, formatIsoDate } from '../../domain/format';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Paper withBorder radius="lg" p="md" component="section" aria-label={title}>
      <Stack gap="sm">
        <Title order={3} size="h5">{title}</Title>
        {children}
      </Stack>
    </Paper>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Group gap={8} wrap="nowrap" align="baseline">
      <Text size="sm" c="dimmed" miw={92}>{label}</Text>
      <Text size="sm">{children}</Text>
    </Group>
  );
}

/** Снимок из `/health`: версия, режим и покрытие. Значения не пересчитываются. */
function Snapshot({ health }: { health: HealthReady }) {
  const { start, end } = health.coverage;
  const diagnostic = health.serving_mode === 'diagnostic';
  return (
    <Section title="Снимок прогноза">
      <Stack gap={4}>
        <Field label="Версия"><Code>{health.forecast_version}</Code></Field>
        <Field label="Модель"><Code>{modelName(health.forecast_version)}</Code></Field>
        <Field label="Режим">
          <Badge variant="light" color="gray" radius="sm">{diagnostic ? 'Диагностический снимок' : 'Рабочий снимок'}</Badge>
        </Field>
        <Field label="Покрытие">{formatIsoDate(start)} — {formatIsoDate(end)} ({formatDays(daysInclusive(start, end))})</Field>
      </Stack>
      <Text size="sm">
        {diagnostic
          ? QUALITY_GATE.diagnostic
          : health.quality_passed ? QUALITY_GATE.passed : QUALITY_GATE.unknown}
      </Text>
    </Section>
  );
}

/** Карточка известной модели: устройство и метрики по срезам проверки из справочника фактов. */
function KnownModel({ facts }: { facts: ModelFacts }) {
  return (
    <Section title="Модель">
      <Group gap="xs">
        <Code>{facts.id}</Code>
        <Badge variant="light" color="gray" radius="sm">{facts.status}</Badge>
      </Group>
      <Stack gap={6}>
        {facts.design.map(({ label, value }) => (
          <Group key={label} gap={8} wrap="nowrap" align="baseline">
            <Text size="sm" c="dimmed" miw={92}>{label}</Text>
            <Text size="sm">{value}</Text>
          </Group>
        ))}
      </Stack>
      <Title order={4} size="h6">WAPE-score по срезам проверки</Title>
      <Table withTableBorder={false} aria-label="WAPE-score по срезам проверки">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Срез</Table.Th>
            <Table.Th ta="right">WAPE-score</Table.Th>
            <Table.Th>Оговорка</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {facts.metrics.map((metric) => (
            <Table.Tr key={metric.period}>
              <Table.Td>{metric.period}</Table.Td>
              <Table.Td ta="right" fw={600}>{formatDecimal(metric.score, 3)}</Table.Td>
              <Table.Td><Text size="xs" c="dimmed">{metric.note ?? '—'}</Text></Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Section>
  );
}

/** Неизвестная модель: только версия и ссылка на README, без метрик (spec model-transparency). */
function UnknownModel({ forecastVersion }: { forecastVersion: string }) {
  return (
    <Section title="Модель">
      <Alert color="gray" variant="light" icon={<IconInfoCircle size={18} aria-hidden />}>
        <Stack gap="xs" align="flex-start">
          <Text size="sm">
            Модель <Code>{modelName(forecastVersion)}</Code> не входит в справочник фактов команды, поэтому метрики здесь не
            показываются: интерфейс не считает их сам и не берёт от другой модели.
          </Text>
          <Anchor href={README_URL} target="_blank" rel="noreferrer" size="sm">
            README проекта <IconExternalLink size={13} aria-hidden />
          </Anchor>
        </Stack>
      </Alert>
    </Section>
  );
}

/** Вкладка «О модели»: снимок, модель, качество, применимость, источники и ограничения. */
export function ModelTab({ health }: { health: HealthReady }) {
  const facts = modelFacts(health.forecast_version);
  const osmDate = OSM_ROUTES.osm_base ?? OSM_ROUTES.fetched_at;

  return (
    <Stack gap="md" mt="lg">
      <div>
        <Title order={2} size="h3">О модели</Title>
        <Text size="sm" c="dimmed">
          Что показывает прогноз, насколько он точен на проверке, где применим и чего не умеет.
        </Text>
      </div>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
        <Snapshot health={health} />
        {facts ? <KnownModel facts={facts} /> : <UnknownModel forecastVersion={health.forecast_version} />}
      </SimpleGrid>

      <Section title="Как измерялось качество">
        <Stack gap={4}>
          <Text size="sm"><Code>{QUALITY.wape}</Code> — доля ошибки в суммарном пассажиропотоке.</Text>
          <Text size="sm"><Code>{QUALITY.score}</Code> — оценка жюри: 1 — точное попадание, 0 — ошибка не меньше самого потока.</Text>
        </Stack>
        <Text size="sm">{QUALITY.protocol}</Text>
        <Text size="sm">{QUALITY.baseline}</Text>
        <Text size="sm">{QUALITY.official}</Text>
        <Text size="sm">{QUALITY.eda}</Text>
      </Section>

      {/* Это результаты опытов над моделями команды. Под чужим снимком их числа читались бы как его
          метрики, поэтому для неизвестной модели раздел не показывается. */}
      {facts && (
      <Section title="Проверено и не вошло в модель">
        <Text size="xs" c="dimmed">{NOT_INCLUDED_SOURCE}</Text>
        <Stack gap="sm">
          {NOT_INCLUDED.map((idea) => (
            <Stack key={idea.title} gap={2}>
              <Text size="sm" fw={600}>{idea.title}</Text>
              <Text size="sm">{idea.text}</Text>
              {idea.link && (
                <Anchor href={idea.link.url} target="_blank" rel="noreferrer" size="xs">
                  {idea.link.title} <IconExternalLink size={12} aria-hidden />
                </Anchor>
              )}
            </Stack>
          ))}
        </Stack>
      </Section>
      )}

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
        <Section title="Область определения">
          <List size="sm" spacing={6}>
            {APPLICABILITY.map((item) => <List.Item key={item}>{item}</List.Item>)}
          </List>
        </Section>
        <Section title="Область адаптации">
          <Table withTableBorder={false} aria-label="Что нужно для расширения решения">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Что расширяем</Table.Th>
                <Table.Th>Что для этого нужно</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {ADAPTATION.map(({ need, requires }) => (
                <Table.Tr key={need}>
                  <Table.Td>{need}</Table.Td>
                  <Table.Td>{requires}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Section>
      </SimpleGrid>

      <Section title="Источники данных">
        <Table aria-label="Источники данных">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Источник</Table.Th>
              <Table.Th>Для чего</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {SOURCES.map((source) => (
              <Table.Tr key={source.url}>
                <Table.Td>
                  <Anchor href={source.url} target="_blank" rel="noreferrer" size="sm">
                    {source.title} <IconExternalLink size={13} aria-hidden />
                  </Anchor>
                </Table.Td>
                <Table.Td><Text size="sm">{source.purpose}</Text></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Section>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
        <Section title="Ограничения">
          <List size="sm" spacing={6}>
            {LIMITATIONS.map((item) => <List.Item key={item}>{item}</List.Item>)}
          </List>
          <Text size="xs" c="dimmed">Геометрия OpenStreetMap выгружена по состоянию базы на {formatIsoDate(osmDate.slice(0, 10))}.</Text>
        </Section>
        <Section title="План развития">
          <List size="sm" spacing={6}>
            {ROADMAP.map((item) => <List.Item key={item}>{item}</List.Item>)}
          </List>
        </Section>
      </SimpleGrid>
    </Stack>
  );
}
