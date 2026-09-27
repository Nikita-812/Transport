import { screen } from '@testing-library/react';
import { getInstanceByDom } from 'echarts/core';
import { StrictMode } from 'react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../test/render';
import { EChart } from './EChart';
import type { ChartOption } from './echarts';

const OPTION: ChartOption = {
  xAxis: { type: 'category', data: ['08:00', '09:00'] },
  yAxis: { type: 'value' },
  series: [{ type: 'line', name: 'Маршрут 17', data: [10, 20] }],
};

function chartOf(label: string) {
  return getInstanceByDom(screen.getByRole('img', { name: label }));
}

describe('обёртка ECharts', () => {
  it('монтирует график, применяет опцию и освобождает экземпляр при размонтировании', () => {
    const view = renderWithProviders(<EChart option={OPTION} height={200} ariaLabel="Тестовый график" />);
    const element = screen.getByRole('img', { name: 'Тестовый график' });
    const chart = getInstanceByDom(element);
    expect(chart).toBeDefined();
    expect(chart?.isDisposed()).toBeFalsy();
    expect(chart?.getOption().series).toHaveLength(1);
    view.unmount();
    expect(chart?.isDisposed()).toBe(true);
    expect(getInstanceByDom(element)).toBeUndefined();
  });

  it('двойной монтаж StrictMode оставляет один живой экземпляр', () => {
    renderWithProviders(
      <StrictMode>
        <EChart option={OPTION} height={200} ariaLabel="График в StrictMode" />
      </StrictMode>,
    );
    const chart = chartOf('График в StrictMode');
    expect(chart).toBeDefined();
    expect(chart?.isDisposed()).toBeFalsy();
    expect(screen.getAllByRole('img', { name: 'График в StrictMode' })).toHaveLength(1);
  });

  it('новая опция заменяет серии целиком, а не дополняет их', () => {
    const view = renderWithProviders(<EChart option={OPTION} height={200} ariaLabel="Смена опции" />);
    view.rerender(
      <EChart
        option={{ ...OPTION, series: [{ type: 'line', name: 'Итог', data: [1, 2] }] }}
        height={200}
        ariaLabel="Смена опции"
      />,
    );
    const series = chartOf('Смена опции')?.getOption().series;
    expect(series).toHaveLength(1);
    expect((series as { name?: string }[])[0]?.name).toBe('Итог');
  });
});
