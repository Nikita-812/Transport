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

function hourProfileOption(base: HourProfileData, scenario: HourProfileData | undefined, scheme: ColorScheme): ChartOption {
  const axis = axisStyle(scheme);
  const active = scenario !== undefined;
  return {
    grid: { left: 4, right: 12, top: 36, bottom: 8, containLabel: true },
    legend: { ...legendStyle(scheme), type: 'scroll', top: 0, left: 0 },
    tooltip: { ...tooltipStyle(scheme), trigger: 'axis', formatter: (params: unknown) => tooltipContent(params) },
    xAxis: { type: 'category', data: base.labels, boundaryGap: true, ...axis },
    yAxis: { type: 'value', ...axis, axisLabel: { ...axis.axisLabel, formatter: (value: number) => formatCompact(value) } },
    series: [
      ...base.lines.map((line) => ({
        type: 'line' as const,
        name: active ? `${line.name} · база` : line.name,
        data: line.values,
        color: line.color,
        showSymbol: false,
        lineStyle: { width: 2, type: 'solid' as const },
      })),
      ...(scenario?.lines ?? []).map((line) => ({
        type: 'line' as const,
        name: `${line.name} · сценарий`,
        data: line.values,
        color: line.color,
        showSymbol: false,
        lineStyle: { width: 2.5, type: 'dashed' as const },
      })),
    ],
  };
}

/** Профиль «час суток»: сплошная база и пунктир сценария по каждому часу. */
export function HourProfileChart({ base, scenario, height = 260 }: { base: HourProfileData; scenario?: HourProfileData; height?: number }) {
  const scheme = useComputedColorScheme('light');
  const option = useMemo(() => hourProfileOption(base, scenario, scheme), [base, scenario, scheme]);
  return <EChart option={option} height={height} ariaLabel="Профиль посадок по часам суток, в среднем за день" />;
}
