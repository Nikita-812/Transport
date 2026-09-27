import { useComputedColorScheme } from '@mantine/core';
import { useMemo } from 'react';
import { LOAD_SCALE } from '../../data/route-colors';
import { formatCompact, formatInteger } from '../../domain/format';
import { axisStyle, chartPalette, tooltipStyle, type ColorScheme } from './chartTheme';
import { EChart } from './EChart';
import type { ChartOption } from './echarts';
import type { HeatmapData } from './series';

interface CellTooltipPoint {
  value?: unknown;
}

function tooltipContent(data: HeatmapData, params: unknown): string {
  const point = (Array.isArray(params) ? params[0] : params) as CellTooltipPoint | undefined;
  const cell = Array.isArray(point?.value) ? (point.value as [number, number, number]) : null;
  if (!cell) return '';
  const [hour, weekday, value] = cell;
  return `<b>${data.weekdayLabels[weekday] ?? ''} · ${data.hourLabels[hour] ?? ''}</b><div>в среднем за день: <b>${formatInteger(value)}</b></div>`;
}

function heatmapOption(data: HeatmapData, scheme: ColorScheme): ChartOption {
  const axis = axisStyle(scheme);
  const palette = chartPalette(scheme);
  return {
    grid: { left: 4, right: 12, top: 8, bottom: 48, containLabel: true },
    tooltip: { ...tooltipStyle(scheme), trigger: 'item', formatter: (params: unknown) => tooltipContent(data, params) },
    xAxis: { type: 'category', data: data.hourLabels, splitArea: { show: false }, ...axis, splitLine: { show: false } },
    yAxis: { type: 'category', data: data.weekdayLabels, splitArea: { show: false }, ...axis, splitLine: { show: false } },
    visualMap: {
      min: data.min,
      max: data.max,
      calculable: false,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      itemWidth: 12,
      itemHeight: 90,
      inRange: { color: [...LOAD_SCALE] },
      textStyle: { color: palette.muted },
      formatter: (value: unknown) => (typeof value === 'number' ? formatCompact(value) : ''),
    },
    series: [{
      type: 'heatmap',
      name: 'Среднее за день',
      data: data.cells,
      progressive: 0,
      itemStyle: { borderColor: palette.tooltipBackground, borderWidth: 1 },
      emphasis: { itemStyle: { borderColor: palette.text, borderWidth: 1 } },
    }],
  };
}

/** Тепловая карта «день недели × час»: среднее за день, понедельник сверху. */
export function WeekdayHourHeatmap({ data, height = 300 }: { data: HeatmapData; height?: number }) {
  const scheme = useComputedColorScheme('light');
  const option = useMemo(() => heatmapOption(data, scheme), [data, scheme]);
  return <EChart option={option} height={height} ariaLabel="Тепловая карта посадок: день недели и час, в среднем за день" />;
}
