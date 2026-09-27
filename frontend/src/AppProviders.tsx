import { MantineProvider } from '@mantine/core';
import { DatesProvider } from '@mantine/dates';
import { Notifications } from '@mantine/notifications';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import 'dayjs/locale/ru';
import { useState, type ReactNode } from 'react';
import { createQueryClient } from './queryClient';
import { createColorSchemeManager, DEFAULT_COLOR_SCHEME, theme } from './theme';

interface AppProvidersProps {
  children: ReactNode;
  /** Свой клиент запросов — для тестов. */
  queryClient?: QueryClient;
  /** `test` отключает анимации и порталы Mantine в тестах. */
  env?: 'default' | 'test';
}

export function AppProviders({ children, queryClient, env = 'default' }: AppProvidersProps) {
  const [client] = useState(() => queryClient ?? createQueryClient());
  const [colorSchemeManager] = useState(createColorSchemeManager);
  return (
    <QueryClientProvider client={client}>
      <MantineProvider theme={theme} defaultColorScheme={DEFAULT_COLOR_SCHEME} colorSchemeManager={colorSchemeManager} env={env}>
        <DatesProvider settings={{ locale: 'ru', firstDayOfWeek: 1, weekendDays: [0, 6] }}>
          <Notifications position="top-right" limit={3} />
          {children}
        </DatesProvider>
      </MantineProvider>
    </QueryClientProvider>
  );
}
