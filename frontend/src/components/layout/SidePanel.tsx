import { Divider, ScrollArea, Stack } from '@mantine/core';
import { FiltersPanel } from '../filters/FiltersPanel';
import { ScenarioPanel } from '../scenario/ScenarioPanel';

/**
 * Фильтры и три сценарные поправки.
 */
export function SidePanel() {
  return (
    <ScrollArea h="100%" type="auto" offsetScrollbars>
      <Stack gap="md" p="md">
        <FiltersPanel />
        <Divider />
        <ScenarioPanel />
      </Stack>
    </ScrollArea>
  );
}
