import { Alert } from '@mantine/core';
import { Component, type ErrorInfo, type ReactNode } from 'react';

/** Ошибка карты не должна ронять дашборд: остальные вкладки продолжают работать (spec «Basemap failure»). */
export class MapErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Ошибка вкладки «Карта»', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <Alert color="red" title="Карта не отображается" mt="lg">
        Во вкладке карты произошла ошибка. Остальные вкладки работают; обновите страницу, чтобы попробовать снова.
      </Alert>
    );
  }
}
