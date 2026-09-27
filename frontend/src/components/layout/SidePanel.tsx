import { Divider, ScrollArea, Stack, Text, Title } from '@mantine/core';

const SECTIONS = [
  { title: 'Маршруты', hint: 'Выбор маршрутов в цветах палитры и кнопка «Все».' },
  { title: 'Период и часы', hint: 'Горизонт «день / месяц / год / период», даты в пределах покрытия, диапазон часов.' },
  { title: 'Сценарий', hint: 'Корректирующие коэффициенты: погода, сезон, события.' },
] as const;

/**
 * Заготовка левой панели. Фильтры появятся в разделе 2, сценарий — в разделе 6.
 */
export function SidePanel() {
  return (
    <ScrollArea h="100%" type="auto" offsetScrollbars>
      <Stack gap="md" p="md">
        {SECTIONS.map((section, index) => (
          <Stack gap={4} key={section.title}>
            {index > 0 && <Divider mb="sm" />}
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
