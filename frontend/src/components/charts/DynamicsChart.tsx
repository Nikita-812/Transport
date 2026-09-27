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

function dynamicsOption(base: DynamicsData, scenario: DynamicsData | undefined, scheme: ColorScheme): ChartOption {
  const palette = chartPalette(scheme);
  const axis = axisStyle(scheme);
  const area = base.lines.length === 1 && base.lines[0]?.route === null;
  const active = scenario !== undefined;
  const baseSeries = base.lines.map((line, position) => ({
    type: 'line' as const,
    name: active ? `${line.name} · база` : line.name,
    data: line.values,
    color: line.color,
    showSymbol: false,
    sampling: 'lttb' as const,
    lineStyle: { width: 2, type: 'solid' as const },
    ...(area ? { areaStyle: { opacity: 0.12 } } : {}),
    ...(position === 0
      ? {
        markArea: {
          silent: true,
          itemStyle: { color: palette.mark },
          label: { show: true, position: 'insideTop' as const, rotate: 90, color: palette.muted, fontSize: 10, width: 90, overflow: 'truncate' as const, distance: 6 },
          data: base.marks.map((mark): [{ name: string; xAxis: number }, { xAxis: number }] => [
            { name: mark.name, xAxis: mark.from - 0.5 }, { xAxis: mark.to + 0.5 },
          ]),
        },
      }
      : {}),
  }));
  const scenarioSeries = (scenario?.lines ?? []).map((line) => ({
    type: 'line' as const,
    name: `${line.name} · сценарий`,
    data: line.values,
    color: line.color,
    showSymbol: false,
    sampling: 'lttb' as const,
    lineStyle: { width: 2.5, type: 'dashed' as const },
  }));
  return {
    grid: { left: 4, right: 12, top: 36, bottom: base.zoom ? 58 : 8, containLabel: true },
    legend: { ...legendStyle(scheme), type: 'scroll', top: 0, left: 0 },
    tooltip: { ...tooltipStyle(scheme), trigger: 'axis', formatter: (params: unknown) => tooltipContent(base, params) },
    xAxis: { type: 'category', data: base.labels, boundaryGap: true, ...axis },
    yAxis: { type: 'value', ...axis, axisLabel: { ...axis.axisLabel, formatter: (value: number) => formatCompact(value) } },
    ...(base.zoom ? { dataZoom: [{ type: 'slider', height: 22, bottom: 12, borderColor: palette.axis, textStyle: { color: palette.muted } }, { type: 'inside' }] } : {}),
    series: [...baseSeries, ...scenarioSeries],
  };
}

export function DynamicsChart({ base, scenario, height = 320 }: { base: DynamicsData; scenario?: DynamicsData; height?: number }) {
  const scheme = useComputedColorScheme('light');
  const option = useMemo(() => dynamicsOption(base, scenario, scheme), [base, scenario, scheme]);
  return <EChart option={option} height={height} ariaLabel="График динамики прогноза посадок" />;
}
