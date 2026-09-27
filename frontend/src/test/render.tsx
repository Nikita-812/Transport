import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { AppProviders } from '../AppProviders';
import { createQueryClient } from '../queryClient';

/** Рендер с провайдерами приложения и свежим клиентом запросов (кэш не протекает между тестами). */
export function renderWithProviders(ui: ReactElement): RenderResult {
  return render(
    <AppProviders queryClient={createQueryClient()} env="test">
      {ui}
    </AppProviders>,
  );
}
