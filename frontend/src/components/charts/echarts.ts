// Модульный импорт ECharts (design D10): в сборку попадают только нужные серии и компоненты.
// Полный пакет `echarts` нигде не импортируется, иначе бюджет размера D14 не выполняется.
import { BarChart, HeatmapChart, LineChart } from 'echarts/charts';
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import { init, use as registerEchartsModules, type ComposeOption, type ECharts } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

import type { BarSeriesOption, HeatmapSeriesOption, LineSeriesOption } from 'echarts/charts';
import type {
  DataZoomComponentOption,
  GridComponentOption,
  LegendComponentOption,
  TooltipComponentOption,
  VisualMapComponentOption,
} from 'echarts/components';

registerEchartsModules([
  LineChart,
  BarChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkAreaComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

/** Опции только зарегистрированных модулей: неподключённый компонент не пройдёт проверку типов. */
export type ChartOption = ComposeOption<
  | LineSeriesOption
  | BarSeriesOption
  | HeatmapSeriesOption
  | GridComponentOption
  | TooltipComponentOption
  | LegendComponentOption
  | DataZoomComponentOption
  | VisualMapComponentOption
>;

export { init, type ECharts };
