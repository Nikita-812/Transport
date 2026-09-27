// Окраска линий для выбранного часа: только paint-выражения, без новых данных и запросов (design D8).
import type { ExpressionSpecification } from 'maplibre-gl';
import type { RouteId } from '../../api/types';
import { LOAD_SCALE } from '../../data/route-colors';
import { lineWidth, loadClass, MIN_LINE_WIDTH, type LoadScale, type RouteHourLoad } from '../../domain/mapLoad';

/** Маршрут выбран, но его данных нет (загрузка или ошибка): тонкая серая линия. */
export const NO_DATA_COLOR = '#868e96';
/** Тёмная обводка: жёлтый верхний класс читается и на светлых улицах подложки, и на сером фоне без неё. */
export const CASING_COLOR = '#1f2328';
export const CASING_EXTRA_WIDTH = 2.5;

export interface HourPaint {
  colors: Map<RouteId, string>;
  widths: Map<RouteId, number>;
  /** Класс нагрузки 0–4 для подписи и проверок. */
  classes: Map<RouteId, number>;
  values: Map<RouteId, number>;
}

/** Цвет и толщина каждой линии в выбранный час; маршрут без значения остаётся серым. */
export function hourPaint(loads: readonly RouteHourLoad[], hour: number, scale: LoadScale | null): HourPaint {
  const paint: HourPaint = { colors: new Map(), widths: new Map(), classes: new Map(), values: new Map() };
  if (!scale) return paint;
  for (const load of loads) {
    const value = load.values[hour];
    if (value === null || value === undefined) continue;
    const loadClassIndex = loadClass(value, scale);
    paint.values.set(load.route, value);
    paint.classes.set(load.route, loadClassIndex);
    paint.colors.set(load.route, LOAD_SCALE[loadClassIndex]!);
    paint.widths.set(load.route, lineWidth(value, scale));
  }
  return paint;
}

/** `['match', ['get', 'route'], 1, …, 5, …, запасное]`; без значений — просто запасное. */
export function routeMatch<T extends string | number>(values: ReadonlyMap<RouteId, T>, fallback: T): ExpressionSpecification | T {
  if (!values.size) return fallback;
  // Кортеж match собирается из пар «маршрут → значение»; его длину TypeScript не выводит.
  return ['match', ['get', 'route'], ...[...values].flat(), fallback] as unknown as ExpressionSpecification;
}

/** Толщина обводки: на `CASING_EXTRA_WIDTH` шире линии. */
export function casingWidths(widths: ReadonlyMap<RouteId, number>): Map<RouteId, number> {
  return new Map([...widths].map(([route, width]) => [route, width + CASING_EXTRA_WIDTH]));
}

export const NO_DATA_WIDTH = MIN_LINE_WIDTH;
