import apiClient from './client';
import {
  MarketDataByTypeApiResponse, MarketDataByTypeResponse, QuoteResponse, CandleItem,
  SymbolSearchApiResponse, SymbolSearchResult,
} from '../types/api';

/**
 * Busca símbolos por texto contra el catálogo de Tastytrade.
 *
 * `instrumentTypes` acota el resultado y lo declara quien pregunta — en GEX sale de
 * `universe.ad_hoc_search.allowed_instrument_types`. Vacío devuelve todo lo que matchea, incluidos
 * futuros y contratos de opción sueltos, que no se pueden barrer.
 */
export async function searchSymbols(
  query: string,
  instrumentTypes?: string[],
): Promise<SymbolSearchResult[]> {
  const { data } = await apiClient.get<SymbolSearchApiResponse>(
    '/Data/Tastytrade/Symbols/Search',
    {
      params: {
        Symbol: query,
        InstrumentTypes: instrumentTypes?.length ? instrumentTypes.join(',') : undefined,
      },
    },
  );
  return data?.items ?? [];
}

export async function fetchMarketDataByType(symbol: string): Promise<MarketDataByTypeResponse> {
  const results = await fetchMarketDataBatch([symbol]);
  const item = results[0];
  if (!item) throw new Error(`No market data for ${symbol}`);
  return item;
}

export async function fetchMarketDataBatch(symbols: string[]): Promise<MarketDataByTypeResponse[]> {
  const { data } = await apiClient.get<MarketDataByTypeApiResponse>(
    '/Data/Tastytrade/MarketData/ByType',
    { params: { Symbol: symbols.join(',') } }
  );
  const items = data?.data?.items ?? [];
  return items.map((item) => ({
    symbol:    item.symbol,
    open:      item.open,
    prevClose: item['prev-close'],
    last:      item.last,
    bid:       item.bid,
    ask:       item.ask,
    volume:    item.volume,
  }));
}

export async function fetchQuote(symbol: string): Promise<QuoteResponse> {
  const { data } = await apiClient.get<QuoteResponse>(
    '/Data/Tastytrade/MarketData/Quote',
    { params: { Symbol: symbol } }
  );
  return data;
}

/** Today's 09:30 ET in ISO UTC format, for use as fromTime in Candle requests. */
function todayMarketOpenISO(): string {
  const now = new Date();
  const month = now.getUTCMonth() + 1;
  const etOffset = month >= 3 && month <= 11 ? 4 : 5;
  const d = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
    9 + etOffset, 30
  ));
  return d.toISOString().replace('.000Z', 'Z');
}

/** Fetch N days of daily candles for a symbol */
export async function fetchDailyCandles(symbol: string, days = 5): Promise<CandleItem[]> {
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - days - 2); // buffer for weekends
  const fromTime = from.toISOString().slice(0, 10);
  const { data } = await apiClient.get<{ data: any[] }>(
    '/Data/Tastytrade/MarketData/Candle',
    { params: { Symbol: symbol, Interval: 'd', FromTime: fromTime }, timeout: 20_000 }
  );
  const raw: any[] = Array.isArray(data) ? data : (data?.data ?? []);
  return raw
    .map((c: any) => {
      const t = typeof c.time === 'number'
        ? (c.time > 1e10 ? Math.floor(c.time / 1000) : c.time)
        : 0;
      return { time: t, open: c.open, high: c.high, low: c.low, close: c.close };
    })
    .filter(c => c.time > 0 && c.close > 0)
    .sort((a, b) => a.time - b.time);
}

interface EquityCandleOptions {
  /** Días calendario hacia atrás para el FromTime. Sin esto arranca en el open de hoy (intradía). */
  fromDays?: number;
  /** Se queda con las últimas N velas. Sin esto devuelve todas las que llegaron. */
  limit?: number;
}

export async function fetchEquityCandles(
  symbol: string,
  interval = '5m',
  opts: EquityCandleOptions = {},
): Promise<CandleItem[]> {
  let fromTime = todayMarketOpenISO();
  if (opts.fromDays) {
    const from = new Date();
    from.setUTCDate(from.getUTCDate() - opts.fromDays);
    fromTime = from.toISOString().replace('.000Z', 'Z');
  }
  const { data } = await apiClient.get<{ data: any[] }>(
    '/Data/Tastytrade/MarketData/Candle',
    { params: { Symbol: symbol, Interval: interval, FromTime: fromTime }, timeout: 30_000 }
  );
  console.debug(`[Candle] ${symbol}:`, data);
  const raw: any[] = Array.isArray(data) ? data : (data?.data ?? []);
  const candles = raw
    .map((c: any) => {
      // time can be unix ms or unix s
      const t = typeof c.time === 'number'
        ? (c.time > 1e10 ? Math.floor(c.time / 1000) : c.time)
        : 0;
      return { time: t, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
    })
    .filter((c) => c.time > 0 && c.close > 0 && c.open > 0)
    .sort((a, b) => a.time - b.time);

  return opts.limit ? candles.slice(-opts.limit) : candles;
}

/** El día de un símbolo (WS-0036): último, cierre anterior, variación, volumen, máximo y mínimo, calculados en la API. */
export interface MarketSummary {
  symbol: string; last: number | null; prevClose: number | null; change: number | null; changePct: number | null;
  volume: number | null; high: number | null; low: number | null; sessionDate: string | null;
}

export async function fetchMarketSummary(symbol: string): Promise<MarketSummary> {
  const { data } = await apiClient.get<MarketSummary>('/App/GaleCore/Market/Summary', { params: { symbol }, timeout: 15_000 });
  return data;
}
