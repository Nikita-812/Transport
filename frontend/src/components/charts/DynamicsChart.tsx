import { useComputedColorScheme } from '@mantine/core';
import { useMemo } from 'react';
import { formatCompact, formatInteger } from '../../domain/format';
import { axisStyle, chartPalette, legendStyle, tooltipStyle, type ColorScheme } from './chartTheme';
import { EChart } from './EChart';
import type { ChartOption } from './echarts';
import type { DynamicsData } from './series';

interface AxisTooltipPoint {
  dataIndex: number;
  seriesName?: string;
  marker?: string;
  value?: unknown;
}

/** Подсказка оси: полная подпись корзины, пояснение календаря и значения всех линий в ru-RU. */
function tooltipContent(data: DynamicsData, params: unknown): string {
  const points = (Array.isArray(params) ? params : [params]) as AxisTooltipPoint[];
  const index = points[0]?.dataIndex ?? 0;
  const note = data.notes[index];
  const head = [`<b>${data.titles[index] ?? ''}</b>`, note ? `<div>${note}</div>` : ''].join('');
  const rows = points.map((point) => {
    const value = typeof point.value === 'number' ? formatInteger(point.value) : '—';
    return `<div>${point.marker ?? ''} ${point.seriesName ?? ''}: <b>${value}</b></div>`;
  });
  return head + rows.join('');
}

function dynamicsOption(data: DynamicsData, scheme: ColorScheme): ChartOption {
  const palette = chartPalette(scheme);
  const axis = axisStyle(scheme);
  const area = data.lines.length === 1 && data.lines[0]?.route === null;
  return {
    grid: { left: 4, right: 12, top: 36, bottom: data.zoom ? 58 : 8, containLabel: true },
    legend: { ...legendStyle(scheme), type: 'scroll', top: 0, left: 0 },
    tooltip: { ...tooltipStyle(scheme), trigger: 'axis', formatter: (params: unknown) => tooltipContent(data, params) },
    xAxis: { type: 'category', data: data.labels, boundaryGap: true, ...axis },
    yAxis: { type: 'value', ...axis, axisLabel: { ...axis.axisLabel, formatter: (value: number) => formatCompact(value) } },
    ...(data.zoom ? { dataZoom: [{ type: 'slider', height: 22, bottom: 12, borderColor: palette.axis, textStyle: { color: palette.muted } }, { type: 'inside' }] } : {}),
    series: data.lines.map((line, position) => ({
      type: 'line' as const,
      name: line.name,
      data: line.values,
      color: line.color,
      // Длинные ряды: точки не рисуем, прореживание lttb сохраняет форму (design D10).
      showSymbol: false,
      sampling: 'lttb' as const,
      lineStyle: { width: 2 },
      ...(area ? { areaStyle: { opacity: 0.18 } } : {}),
      // Полосы праздников принадлежат первой серии, иначе ECharts нарисует их столько раз, сколько линий.
      ...(position === 0
        ? {
          markArea: {
            silent: true,
            itemStyle: { color: palette.mark },
            label: { show: true, position: 'insideTop' as const, rotate: 90, color: palette.muted, fontSize: 10, width: 90, overflow: 'truncate' as const, distance: 6 },
            data: data.marks.map((mark) => [{ name: mark.name, xAxis: mark.from - 0.5 }, { xAxis: mark.to + 0.5 }]),
          },
        }
        : {}),
    })),
  };
}

export function DynamicsChart({ data, height = 320 }: { data: DynamicsData; height?: number }) {
  const scheme = useComputedColorScheme('light');
  const option = useMemo(() => dynamicsOption(data, scheme), [data, scheme]);
  return <EChart option={option} height={height} ariaLabel="График динамики прогноза посадок" />;
}
