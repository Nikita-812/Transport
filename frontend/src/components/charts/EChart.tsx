import { useComputedColorScheme } from '@mantine/core';
import { useEffect, useRef } from 'react';
import { baseOption } from './chartTheme';
import { init, type ChartOption, type ECharts } from './echarts';

interface EChartProps {
  /** Готовая опция графика; строится чистой функцией и мемоизируется вызывающим компонентом. */
  option: ChartOption;
  height: number;
  /** Доступное описание: график — картинка, поэтому смысл дублируется текстом. */
  ariaLabel: string;
}

/**
 * Тонкая обёртка ECharts вместо `echarts-for-react` (design D1): собственный жизненный цикл.
 * Инициализация и `dispose` живут в одном эффекте, поэтому двойной монтаж React StrictMode
 * не оставляет второй экземпляр на том же элементе. Размер отслеживает ResizeObserver.
 */
export function EChart({ option, height, ariaLabel }: EChartProps) {
  const container = useRef<HTMLDivElement | null>(null);
  const chart = useRef<ECharts | null>(null);
  const scheme = useComputedColorScheme('light');

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const instance = init(element, undefined, { renderer: 'canvas' });
    chart.current = instance;
    const observer = new ResizeObserver(() => {
      if (!instance.isDisposed()) instance.resize();
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);

  // Полная замена опции: серии и оси меняются вместе с фильтрами, слияние оставило бы старые серии.
  useEffect(() => {
    const instance = chart.current;
    if (!instance || instance.isDisposed()) return;
    instance.setOption({ ...baseOption(scheme), ...option }, { notMerge: true });
  }, [option, scheme]);

  return <div ref={container} role="img" aria-label={ariaLabel} style={{ width: '100%', height }} />;
}
