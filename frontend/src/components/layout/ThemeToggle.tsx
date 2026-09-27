import { ActionIcon, Tooltip, useComputedColorScheme, useMantineColorScheme } from '@mantine/core';
import { IconMoon, IconSun } from '@tabler/icons-react';

/** Переключатель светлой (по умолчанию) и тёмной темы; выбор сохраняется менеджером темы (theme.ts). */
export function ThemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme('light', { getInitialValueInEffect: false });
  const dark = computed === 'dark';
  const label = dark ? 'Включить светлую тему' : 'Включить тёмную тему';
  return (
    <Tooltip label={label}>
      <ActionIcon variant="default" size="lg" radius="md" aria-label={label} onClick={() => setColorScheme(dark ? 'light' : 'dark')}>
        {dark ? <IconSun size={18} aria-hidden /> : <IconMoon size={18} aria-hidden />}
      </ActionIcon>
    </Tooltip>
  );
}
