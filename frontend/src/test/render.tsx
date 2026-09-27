import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { AppProviders } from '../AppProviders';
import { createQueryClient } from '../queryClient';

/**
 * Рендер с провайдерами приложения и свежим клиентом запросов (кэш не протекает между тестами).
 * Провайдеры заданы через `wrapper`, поэтому `rerender` сохраняет их.
 */
export function renderWithProviders(ui: ReactElement): RenderResult {
  const queryClient = createQueryClient();
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <AppProviders queryClient={queryClient} env="test">
      {children}
    </AppProviders>
  );
  return render(ui, { wrapper: Wrapper });
}
