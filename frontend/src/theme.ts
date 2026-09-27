import { createTheme, type MantineColorScheme, type MantineColorSchemeManager } from '@mantine/core';
import { readString, removeValue, storageKey, writeString } from './state/persist';

/** Имя ключа темы; полный ключ (`tram-dashboard:color-scheme`) читает и inline-скрипт в index.html. */
const COLOR_SCHEME_KEY = 'color-scheme';

export const DEFAULT_COLOR_SCHEME = 'light' satisfies MantineColorScheme;

function isScheme(value: unknown): value is 'light' | 'dark' {
  return value === 'light' || value === 'dark';
}

/**
 * Хранение темы в localStorage через безопасные обёртки: недоступное хранилище не ломает интерфейс,
 * а тема тогда просто не запоминается. Изменение в другой вкладке подхватывается событием `storage`.
 */
export function createColorSchemeManager(): MantineColorSchemeManager {
  let listener: ((event: StorageEvent) => void) | undefined;
  return {
    get: (defaultValue) => {
      const stored = readString(COLOR_SCHEME_KEY);
      return isScheme(stored) ? stored : defaultValue;
    },
    set: (value) => {
      writeString(COLOR_SCHEME_KEY, value);
    },
    subscribe: (onUpdate) => {
      listener = (event) => {
        if (event.key === storageKey(COLOR_SCHEME_KEY) && isScheme(event.newValue)) onUpdate(event.newValue);
      };
      window.addEventListener('storage', listener);
    },
    unsubscribe: () => {
      if (listener) window.removeEventListener('storage', listener);
      listener = undefined;
    },
    clear: () => {
      removeValue(COLOR_SCHEME_KEY);
    },
  };
}

export const theme = createTheme({
  primaryColor: 'indigo',
  defaultRadius: 'md',
  // Системные шрифты (design D2): в однофайловую сборку шрифты не встраиваются.
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif',
  fontFamilyMonospace: 'ui-monospace, "Cascadia Mono", "Segoe UI Mono", Consolas, "Liberation Mono", monospace',
  headings: { fontWeight: '650' },
  cursorType: 'pointer',
  focusRing: 'auto',
});
