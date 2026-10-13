import { portfolioRows } from './portfolioSummary';
import { PositionResponse } from '../types/api';
const leg = (symbol: string, direction: string, entry: number, close: number, quantity = 2) => ({ symbol, underlyingSymbol: 'SPY', instrumentType: 'Equity Option', quantityDirection: direction, averageOpenPrice: entry, closePrice: close, quantity, multiplier: 100 } as PositionResponse);
const short = leg('SPY   261016P00500000', 'Short', 3, 2);
const long = leg('SPY   261016P00495000', 'Long', 1, .5);
test('PCS conserva cantidad y calcula P&L sobre cr?dito neto, exposici?n por patas', () => {
  expect(portfolioRows([short, long])).toEqual([expect.objectContaining({ structure: 'PCS', quantity: 2, pnl: 100, pct: 25, gross: 500, expiry: '2026-10-16' })]);
});
test('cantidades distintas y estructuras ambiguas nunca ocultan patas', () => {
  expect(portfolioRows([short, { ...long, quantity: 1 }])).toHaveLength(2);
  expect(portfolioRows([short, long, leg('SPY   261016P00490000', 'Long', .5, .2)])).toHaveLength(3);
});
test('precio faltante no se convierte en cero y acciones no tienen vencimiento', () => {
  expect(portfolioRows([{ ...short, closePrice: undefined } as any])[0].pnl).toBeNull();
  expect(portfolioRows([{ ...long, symbol: 'SPY', instrumentType: 'Equity', multiplier: 1 }])[0]).toMatchObject({ structure: 'ACC', expiry: undefined, pnl: -1 });
});
