import { Divider, ScrollArea, Stack, Text, Title } from '@mantine/core';
import { FiltersPanel } from '../filters/FiltersPanel';

const SECTIONS = [
  { title: 'Сценарий', hint: 'Корректирующие коэффициенты: погода, сезон, события.' },
] as const;

/**
 * Фильтры и заготовка сценария для следующего этапа.
 */
export function SidePanel() {
  return (
    <ScrollArea h="100%" type="auto" offsetScrollbars>
      <Stack gap="md" p="md">
        <FiltersPanel />
        {SECTIONS.map((section) => (
          <Stack gap={4} key={section.title}>
            <Divider mb="sm" />
            <Title order={2} size="h6" tt="uppercase" c="dimmed" lts={0.4}>
              {section.title}
            </Title>
            <Text size="sm" c="dimmed">
              {section.hint}
            </Text>
            <Text size="xs" c="dimmed" fs="italic">
              Появится на следующем этапе.
            </Text>
          </Stack>
        ))}
      </Stack>
    </ScrollArea>
  );
}
