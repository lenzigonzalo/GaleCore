import { portfolioRows } from './portfolioSummary';
import { PositionResponse } from '../types/api';
import { useMarketStore } from '../store/useMarketStore';
const leg = (symbol: string, direction: string, entry: number, close: number, quantity = 2) => ({ symbol, underlyingSymbol: 'SPY', instrumentType: 'Equity Option', quantityDirection: direction, averageOpenPrice: entry, closePrice: close, quantity, multiplier: 100 } as PositionResponse);
const short = leg('SPY   261016P00500000', 'Short', 3, 2);
const long = leg('SPY   261016P00495000', 'Long', 1, .5);
const quotes = () => {
  useMarketStore.setState({ tickers: {} });
  useMarketStore.getState().updateQuote('.SPY261016P500', { bidPrice: 1.9, askPrice: 2.1 });
  useMarketStore.getState().updateQuote('.SPY261016P495', { bidPrice: .4, askPrice: .6 });
  useMarketStore.getState().updateQuote('SPY', { bidPrice: .4, askPrice: .6 });
  return useMarketStore.getState().tickers;
};
test('PCS conserva cantidad y calcula P&L sobre cr?dito neto, exposici?n por patas', () => {
  expect(portfolioRows([short, long], quotes())).toEqual([expect.objectContaining({ structure: 'PCS', quantity: 2, pnl: 100, pct: 25, gross: 500, expiry: '2026-10-16' })]);
});
test('cantidades distintas y estructuras ambiguas nunca ocultan patas', () => {
  expect(portfolioRows([short, { ...long, quantity: 1 }])).toHaveLength(2);
  expect(portfolioRows([short, long, leg('SPY   261016P00490000', 'Long', .5, .2)])).toHaveLength(3);
});
test('precio faltante no se convierte en cero y acciones no tienen vencimiento', () => {
  expect(portfolioRows([{ ...short, closePrice: undefined } as any])[0].pnl).toBeNull();
  expect(portfolioRows([{ ...long, symbol: 'SPY', instrumentType: 'Equity', multiplier: 1 }], quotes())[0]).toMatchObject({ structure: 'ACC', expiry: undefined, pnl: -1 });
});

test('el cierre no reemplaza una cotización ausente, incompleta, cruzada o vieja', () => {
  expect(portfolioRows([short, long])[0]).toMatchObject({ pnl: null, pct: null, priceStatus: 'Sin cotización' });
  const ticks = quotes();
  delete ticks['.SPY261016P495'];
  expect(portfolioRows([short, long], ticks)[0].pnl).toBeNull();
  const stale = quotes();
  stale['.SPY261016P495'].lastQuoteReceivedAt = new Date(Date.now() - 61_000);
  expect(portfolioRows([short, long], stale)[0]).toMatchObject({ pnl: null, priceStatus: 'Cotización anterior' });
  const crossed = quotes();
  crossed['.SPY261016P495'].bid = 2;
  expect(portfolioRows([short, long], crossed)[0].pnl).toBeNull();
});

test('PCS SPY de Dev del 14/10: valuación por ambas patas, no cero por closePrice igual a entrada', () => {
  const positions = [leg('SPY   261120P00730000', 'Short', 3.8, 3.8, 1), leg('SPY   261120P00710000', 'Long', 2.4, 2.4, 1)];
  useMarketStore.setState({ tickers: {} });
  useMarketStore.getState().updateQuote('.SPY261120P730', { bidPrice: 3.92, askPrice: 3.95 });
  useMarketStore.getState().updateQuote('.SPY261120P710', { bidPrice: 2.47, askPrice: 2.5 });
  const row = portfolioRows(positions, useMarketStore.getState().tickers)[0];
  expect(row.structure).toBe('PCS');
  expect(row.pnl).toBeCloseTo(-5);
  expect(row.pct).toBeCloseTo(-3.57142857);
});
