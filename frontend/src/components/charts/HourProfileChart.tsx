import { useComputedColorScheme } from '@mantine/core';
import { useMemo } from 'react';
import { formatCompact, formatInteger } from '../../domain/format';
import { axisStyle, legendStyle, tooltipStyle, type ColorScheme } from './chartTheme';
import { EChart } from './EChart';
import type { ChartOption } from './echarts';
import type { HourProfileData } from './series';

interface AxisTooltipPoint {
  axisValueLabel?: string;
  seriesName?: string;
  marker?: string;
  value?: unknown;
}

function tooltipContent(params: unknown): string {
  const points = (Array.isArray(params) ? params : [params]) as AxisTooltipPoint[];
  const head = `<b>${points[0]?.axisValueLabel ?? ''}</b><div>в среднем за день</div>`;
  return head + points.map((point) => {
    const value = typeof point.value === 'number' ? formatInteger(point.value) : '—';
    return `<div>${point.marker ?? ''} ${point.seriesName ?? ''}: <b>${value}</b></div>`;
  }).join('');
}

function hourProfileOption(data: HourProfileData, scheme: ColorScheme): ChartOption {
  const axis = axisStyle(scheme);
  return {
    grid: { left: 4, right: 12, top: 36, bottom: 8, containLabel: true },
    legend: { ...legendStyle(scheme), type: 'scroll', top: 0, left: 0 },
    tooltip: { ...tooltipStyle(scheme), trigger: 'axis', formatter: (params: unknown) => tooltipContent(params) },
    xAxis: { type: 'category', data: data.labels, boundaryGap: true, ...axis },
    yAxis: { type: 'value', ...axis, axisLabel: { ...axis.axisLabel, formatter: (value: number) => formatCompact(value) } },
    series: data.lines.map((line) => ({
      type: 'bar' as const,
      name: line.name,
      data: line.values,
      color: line.color,
      barMaxWidth: 18,
    })),
  };
}

/** Профиль «час суток»: столбцы среднего за день по каждому часу. */
export function HourProfileChart({ data, height = 260 }: { data: HourProfileData; height?: number }) {
  const scheme = useComputedColorScheme('light');
  const option = useMemo(() => hourProfileOption(data, scheme), [data, scheme]);
  return <EChart option={option} height={height} ariaLabel="Профиль посадок по часам суток, в среднем за день" />;
}
