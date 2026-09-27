import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/notifications/styles.css';
import './global.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AppProviders } from './AppProviders';

async function bootstrap(): Promise<void> {
  // Mock-адаптер только в `npm run dev:mock` (design D3). В production-сборке условие ложно на этапе сборки,
  // и модуль вместе с маркером отсекается; scripts/verify_single_file.mjs это проверяет.
  if (import.meta.env.VITE_API_MOCK === '1') {
    const { installMockApi } = await import('./api/mock');
    installMockApi();
  }

  const container = document.getElementById('root');
  if (!container) throw new Error('В index.html нет элемента #root');
  createRoot(container).render(
    <StrictMode>
      <AppProviders>
        <App />
      </AppProviders>
    </StrictMode>,
  );
}

void bootstrap();
