// Тема графиков следует теме приложения (design D10). Цвета заданы явными значениями:
// ECharts рисует на canvas, и CSS-переменные Mantine для него недоступны.
import type { ChartOption } from './echarts';

export type ColorScheme = 'light' | 'dark';

export interface ChartPalette {
  text: string;
  muted: string;
  axis: string;
  split: string;
  tooltipBackground: string;
  tooltipBorder: string;
  /** Линия и колонки разреза «Итог»: маршрутная палитра к итогу не относится. */
  total: string;
  /** Полоса праздника на графике динамики. */
  mark: string;
}

const PALETTES: Record<ColorScheme, ChartPalette> = {
  light: {
    text: '#212529', muted: '#5c636a', axis: '#adb5bd', split: '#e9ecef',
    tooltipBackground: '#ffffff', tooltipBorder: '#ced4da', total: '#343a40', mark: 'rgba(134, 142, 150, 0.22)',
  },
  dark: {
    text: '#e9ecef', muted: '#9aa0a6', axis: '#5c636a', split: '#343a40',
    tooltipBackground: '#25262b', tooltipBorder: '#5c636a', total: '#ced4da', mark: 'rgba(233, 236, 239, 0.14)',
  },
};

export function chartPalette(scheme: ColorScheme): ChartPalette {
  return PALETTES[scheme];
}

/**
 * Основа, которую добавляет обёртка `EChart`: только ключи, которые не задают построители опций,
 * поэтому поверхностное слияние ничего не теряет.
 */
export function baseOption(scheme: ColorScheme): ChartOption {
  return {
    backgroundColor: 'transparent',
    animation: false,
    textStyle: {
      color: chartPalette(scheme).text,
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      fontSize: 12,
    },
  };
}

/** Подсказка в теме приложения; значения строит сам график в формате ru-RU. */
export function tooltipStyle(scheme: ColorScheme) {
  const palette = chartPalette(scheme);
  return {
    backgroundColor: palette.tooltipBackground,
    borderColor: palette.tooltipBorder,
    textStyle: { color: palette.text, fontSize: 12 },
    confine: true,
  } as const;
}

export function legendStyle(scheme: ColorScheme) {
  return { textStyle: { color: chartPalette(scheme).text } } as const;
}

/** Оформление осей: подписи приглушены, линии сетки не спорят с линиями маршрутов. */
export function axisStyle(scheme: ColorScheme) {
  const palette = chartPalette(scheme);
  return {
    axisLine: { lineStyle: { color: palette.axis } },
    axisTick: { lineStyle: { color: palette.axis } },
    axisLabel: { color: palette.muted, hideOverlap: true },
    splitLine: { lineStyle: { color: palette.split } },
    nameTextStyle: { color: palette.muted },
  } as const;
}
