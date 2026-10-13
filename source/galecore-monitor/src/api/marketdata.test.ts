import apiClient from './client';
import { fetchMarketDataBatch } from './marketdata';
jest.mock('./client', () => ({ __esModule: true, default: { get: jest.fn() } }));

test('normaliza el campo prev-close publicado por GaleCore para calcular Chg', async () => {
  (apiClient.get as jest.Mock).mockResolvedValue({ data: { data: { items: [
    { symbol: 'SPY', last: 101, open: 99, 'prev-close': 100, bid: 100, ask: 102, volume: 1000 },
  ] } } });
  expect(await fetchMarketDataBatch(['SPY'])).toEqual([
    { symbol: 'SPY', last: 101, open: 99, prevClose: 100, bid: 100, ask: 102, volume: 1000 },
  ]);
});
