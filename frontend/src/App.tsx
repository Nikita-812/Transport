import { LoadingScreen } from './components/common/LoadingScreen';
import { ServiceUnavailable } from './components/common/ServiceUnavailable';
import { Dashboard } from './components/layout/Dashboard';
import { useHealth } from './hooks/useHealth';

/**
 * Оболочка: пока `/health` не получен — загрузка; при ошибке или неготовом сервисе — полноэкранное
 * сообщение с повтором и без устаревших данных (spec dashboard-shell, «Coverage and snapshot status»).
 */
export function App() {
  const health = useHealth();
  const retry = () => void health.refetch();

  if (health.isPending) return <LoadingScreen />;
  if (health.isError) return <ServiceUnavailable error={health.error} onRetry={retry} retrying={health.isFetching} />;
  if (!health.data.ready) return <ServiceUnavailable onRetry={retry} retrying={health.isFetching} />;
  return <Dashboard />;
}
