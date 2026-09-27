import { useEffect, useState } from 'react';
import type { HealthReady } from '../api/types';
import { useUiStore } from '../state/store';
import { serializeUrl } from '../state/url';

/** Инициализация до монтирования фильтров/запросов; обратная запись не перезагружает страницу. */
export function useDashboardState(health: HealthReady): boolean {
  const [ready, setReady] = useState(false);
  const [initialSearch] = useState(() => window.location.search);
  useEffect(() => {
    const restore = () => useUiStore.getState().initialize(health.coverage, window.location.search);
    useUiStore.getState().initialize(health.coverage, initialSearch);
    const persist = () => {
      const { filters, tab } = useUiStore.getState();
      if (!filters) return;
      const next = `?${serializeUrl(filters, tab)}`;
      if (window.location.search !== next) window.history.replaceState(window.history.state, '', `${window.location.pathname}${next}${window.location.hash}`);
    };
    persist();
    const unsubscribe = useUiStore.subscribe(persist);
    window.addEventListener('popstate', restore);
    const timer = window.setInterval(() => useUiStore.getState().tickNow(), 1000);
    // Начальный барьер: запросы не видят фильтры до проверки URL.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReady(true);
    return () => { unsubscribe(); window.removeEventListener('popstate', restore); window.clearInterval(timer); };
  }, [health, initialSearch]);
  return ready;
}
