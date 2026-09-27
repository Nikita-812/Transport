// Выпуск и расписание (spec operations-planning). Прогноз посадок переводится в требуемое число
// рейсов и интервал движения в пиковый час. Все параметры — допущения, а не данные модели.
import type { RouteId } from '../api/types';
import type { HourRange } from './aggregate';
import { routeHourLoads } from './mapLoad';
import type { RouteSeries } from './series';

export interface PlanningAssumptions {
  /** C — вместимость вагона, пассажиров. */
  capacity: number;
  /** f — целевое заполнение, доля от 0 до 1. */
  fill: number;
  /** s — доля посадок часа, одновременно едущих на самом загруженном перегоне. */
  share: number;
}

export const DEFAULT_ASSUMPTIONS: PlanningAssumptions = { capacity: 180, fill: 0.7, share: 0.35 };

/** Требуемые рейсы в час = ⌈B·s / (C·f)⌉. При B = 0 потребности нет: возвращается 0. */
export function tripsPerHour(boardings: number, { capacity, fill, share }: PlanningAssumptions): number {
  const seats = capacity * fill;
  if (!(boardings > 0) || !(share > 0)) return 0;
  if (!(seats > 0)) return Number.NaN;
  return Math.ceil((boardings * share) / seats);
}

/** Интервал = ⌊60 / рейсы⌋ минут. Без рейсов интервала нет. */
export function headwayMinutes(trips: number): number | null {
  return Number.isFinite(trips) && trips > 0 ? Math.floor(60 / trips) : null;
}

export interface PlanningRow {
  route: RouteId;
  /** Пиковый час; `null`, если у маршрута нет значений в диапазоне часов фильтра. */
  hour: number | null;
  /** B — посадки в пиковый час после сценария. */
  boardings: number;
  trips: number;
  /** Минуты; `null` — «нет потребности». */
  headway: number | null;
}

/**
 * Строка на каждый маршрут по значениям после сценария: на горизонте «День» это прогноз выбранной
 * даты, на периоде — средний день, ровно те же значения, что показывает карта (`routeHourLoads`).
 * При равенстве пиком считается более ранний час, как в KPI и панели остановки.
 */
export function planningRows(series: readonly RouteSeries[], hours: HourRange, assumptions: PlanningAssumptions): PlanningRow[] {
  return routeHourLoads(series, hours).map(({ route, values }) => {
    let hour: number | null = null;
    let boardings = 0;
    for (let index = 0; index < values.length; index++) {
      const value = values[index];
      if (value !== null && value !== undefined && (hour === null || value > boardings)) {
        hour = index;
        boardings = value;
      }
    }
    const trips = tripsPerHour(boardings, assumptions);
    return { route, hour, boardings, trips, headway: headwayMinutes(trips) };
  });
}
