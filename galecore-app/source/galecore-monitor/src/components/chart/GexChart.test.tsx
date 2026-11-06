import { act, fireEvent, render, screen } from '@testing-library/react';
import { createChart } from 'lightweight-charts';
import { fetchEquityCandles } from '../../api/marketdata';
import { GexChart } from './GexChart';

jest.mock('lightweight-charts', () => ({ createChart: jest.fn(), CandlestickSeries: 'candles', LineSeries: 'line', LineStyle: {}, ColorType: {}, CrosshairMode: {} }));
jest.mock('../../api/marketdata', () => ({ fetchEquityCandles: jest.fn() }));
jest.mock('./GexBarsPanel', () => ({ GexBarsPanel: () => null }));

test('Precio encuadra velas y avisos; actualizar avisos conserva zoom manual y Reset lo restaura', async () => {
  const applyOptions = jest.fn();
  const scaleOptions = jest.fn();
  const series = { applyOptions, setData: jest.fn(), update: jest.fn(), createPriceLine: jest.fn(), removePriceLine: jest.fn(), coordinateToPrice: () => 750 };
  (createChart as jest.Mock).mockReturnValue({ addSeries: () => series, removeSeries: jest.fn(), remove: jest.fn(),
    timeScale: () => ({ subscribeVisibleLogicalRangeChange: jest.fn(), fitContent: jest.fn() }),
    priceScale: () => ({ applyOptions: scaleOptions }),
  });
  (fetchEquityCandles as jest.Mock).mockResolvedValue([{ time: 1, open: 740, high: 760, low: 727, close: 745 }]);
  window.ResizeObserver = class { observe() {} disconnect() {} } as any;
  const props = { symbol: 'SPY', currentPrice: 745, gexData: null };
  const alerts = [715, 700, 690].map(price => ({ id: String(price), price, label: `Aviso ${price}` }));
  const { rerender } = render(<GexChart {...props} alertLevels={alerts}/>);
  await act(async () => {});
  const provider = () => applyOptions.mock.calls.filter(c => c[0].autoscaleInfoProvider).slice(-1)[0][0].autoscaleInfoProvider;
  const base = () => ({ priceRange: { minValue: 727, maxValue: 760 }, margins: { above: 2, below: 2 } });
  expect(provider()(base)).toEqual({ priceRange: { minValue: 690, maxValue: 760 }, margins: { above: 2, below: 2 } });
  expect(provider()(() => null)).toEqual({ priceRange: { minValue: 690, maxValue: 715 } });
  expect(provider()(() => ({ priceRange: null }))).toEqual({ priceRange: { minValue: 690, maxValue: 715 } });
  scaleOptions.mockClear();
  rerender(<GexChart {...props} alertLevels={[{ id: 'new', price: 680, label: 'Nuevo' }]}/>);
  expect(provider()(base).priceRange).toEqual({ minValue: 680, maxValue: 760 });
  expect(scaleOptions).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Reset chart' }));
  expect(scaleOptions).toHaveBeenCalledWith(expect.objectContaining({ autoScale: true }));
  rerender(<GexChart {...props} alertLevels={[]}/>);
  expect(provider()(base)).toEqual(base());
});
