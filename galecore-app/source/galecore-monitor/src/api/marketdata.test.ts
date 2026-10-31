import apiClient from './client';
import { fetchEquityCandles, fetchMarketDataBatch, fetchPremarketBatch } from './marketdata';
jest.mock('./client', () => ({ __esModule: true, default: { get: jest.fn() } }));

test('premarket usa endpoint propio y divide el universo por límite de 30', async () => {
  (apiClient.get as jest.Mock).mockClear();
  (apiClient.get as jest.Mock).mockResolvedValue({ data: [] });
  const symbols = Array.from({ length: 31 }, (_, i) => 'S' + i);
  expect(await fetchPremarketBatch(symbols)).toEqual([]);
  expect(apiClient.get).toHaveBeenCalledTimes(2);
  expect(apiClient.get).toHaveBeenNthCalledWith(1, '/App/GaleCore/Market/Premarket', { params: { symbols: symbols.slice(0, 30).join(',') } });
  expect(apiClient.get).toHaveBeenNthCalledWith(2, '/App/GaleCore/Market/Premarket', { params: { symbols: 'S30' } });
});

test('normaliza el campo prev-close publicado por GaleCore para calcular Chg', async () => {
  (apiClient.get as jest.Mock).mockResolvedValue({ data: { data: { items: [
    { symbol: 'SPY', last: 101, open: 99, 'prev-close': 100, bid: 100, ask: 102, volume: 1000 },
  ] } } });
  expect(await fetchMarketDataBatch(['SPY'])).toEqual([
    { symbol: 'SPY', last: 101, open: 99, prevClose: 100, bid: 100, ask: 102, volume: 1000 },
  ]);
});

test('velas: descarta OHLC incompleto y conserva la última actualización por instante antes del límite', async () => {
  const candle = { time: 1792764000000, open: 100, high: 103, low: 99, close: 101, volume: 12 };
  (apiClient.get as jest.Mock).mockResolvedValue({ data: { data: [
    candle, { ...candle, close: 102 }, { ...candle, time: candle.time + 3600000, high: null },
    { ...candle, time: candle.time + 7200000, low: 104 },
  ] } });
  expect(await fetchEquityCandles('SPY', '1h', { fromDays: 30, limit: 100 })).toEqual([
    { time: 1792764000, open: 100, high: 103, low: 99, close: 102, volume: 12 },
  ]);
  expect(apiClient.get).toHaveBeenLastCalledWith('/Data/Tastytrade/MarketData/Candle', expect.objectContaining({ timeout: 45000 }));
});
