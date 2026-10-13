import { create } from 'zustand';
import { TickerState } from '../types/market';
import { TradePayload, QuotePayload, GreeksPayload } from '../types/api';

interface MarketStore {
  tickers: Record<string, TickerState>;

  initTicker:   (symbol: string) => void;
  updatePrice:  (symbol: string, data: TradePayload, streaming?: boolean) => void;
  updateQuote:  (symbol: string, data: QuotePayload) => void;
  updateGreeks: (symbol: string, data: GreeksPayload) => void;
  setOpen:      (symbol: string, open: number, prevClose?: number, volume?: number) => void;
  setStreaming: (symbol: string, streaming: boolean) => void;
  setIVRank:   (symbol: string, ivRank: number) => void;
  setIV:       (symbol: string, iv30: number, iv9d?: number, iv3m?: number) => void;
  setLoading:  (symbol: string, key: keyof TickerState['loading'], value: boolean) => void;
  setError:    (symbol: string, key: keyof TickerState['error'], msg?: string) => void;
}

const defaultLoading = { price: false, ivRank: false, iv: false, gex: false };
const defaultError   = {};

// Base de un ticker todavía sin datos. Todos los reducers parten de acá cuando la clave no existe:
// un update que llega ANTES de initTicker (p.ej. un ReceiveQuote de un símbolo que la plataforma
// suscribe al arrancar, antes de que la grilla monte y llame initTicker) no debe crear un objeto
// parcial sin `symbol` — si lo hace, la card queda sin nombre e initTicker ya no lo corrige.
const emptyTicker = (symbol: string): TickerState => ({
  symbol,
  price: 0, open: 0, bid: 0, ask: 0,
  lastUpdate: null,
  isStreaming: false,
  loading: { ...defaultLoading },
  error:   { ...defaultError },
});

export const useMarketStore = create<MarketStore>((set) => ({
  tickers: {},

  initTicker: (symbol) =>
    set((s) => {
      if (s.tickers[symbol]) return s;
      return { tickers: { ...s.tickers, [symbol]: emptyTicker(symbol) } };
    }),

  updatePrice: (symbol, data, streaming = true) =>
    set((s) => Number.isFinite(data.price) && data.price > 0 ? ({
      tickers: {
        ...s.tickers,
        [symbol]: {
          ...(s.tickers[symbol] ?? emptyTicker(symbol)),
          price: data.price,
          ...(Number.isFinite(data.price) && data.price > 0 && { error: { ...(s.tickers[symbol]?.error ?? defaultError), price: undefined } }),
          lastUpdate: new Date(),
          isStreaming: streaming,
          ...(streaming && { lastTradeReceivedAt: new Date() }),
          ...(data.extendedTradingHours != null && { extendedTradingHours: data.extendedTradingHours, marketStatusReceivedAt: new Date(), marketStatusSourceAt: new Date(data.timestamp) }),
        },
      },
    }) : s),

  updateQuote: (symbol, data) =>
    set((s) => ({
      tickers: {
        ...s.tickers,
        [symbol]: {
          ...(s.tickers[symbol] ?? emptyTicker(symbol)),
          bid: data.bidPrice,
          ask: data.askPrice,
          ...(data.volume != null && { volume: data.volume }),
          lastUpdate: new Date(),
        },
      },
    })),

  updateGreeks: (symbol, data) =>
    set((s) => ({
      tickers: {
        ...s.tickers,
        [symbol]: {
          ...(s.tickers[symbol] ?? emptyTicker(symbol)),
          delta: data.delta,
          gamma: data.gamma,
          theta: data.theta,
          vega:  data.vega,
          ...(data.volatility != null && { iv: data.volatility }),
        },
      },
    })),

  setOpen: (symbol, open, prevClose, volume) =>
    set((s) => ({
      tickers: {
        ...s.tickers,
        [symbol]: { ...(s.tickers[symbol] ?? emptyTicker(symbol)), open, prevClose, volume },
      },
    })),

  setStreaming: (symbol, streaming) =>
    set((s) => ({
      tickers: { ...s.tickers, [symbol]: { ...(s.tickers[symbol] ?? emptyTicker(symbol)), isStreaming: streaming } },
    })),

  setIVRank: (symbol, ivRank) =>
    set((s) => ({
      tickers: { ...s.tickers, [symbol]: { ...(s.tickers[symbol] ?? emptyTicker(symbol)), ivRank } },
    })),

  setIV: (symbol, iv30, iv9d, iv3m) =>
    set((s) => ({
      tickers: { ...s.tickers, [symbol]: { ...(s.tickers[symbol] ?? emptyTicker(symbol)), iv30, iv9d, iv3m } },
    })),

  setLoading: (symbol, key, value) =>
    set((s) => {
      const prev = s.tickers[symbol] ?? emptyTicker(symbol);
      return {
        tickers: {
          ...s.tickers,
          [symbol]: { ...prev, loading: { ...prev.loading, [key]: value } },
        },
      };
    }),

  setError: (symbol, key, msg) =>
    set((s) => {
      const prev = s.tickers[symbol] ?? emptyTicker(symbol);
      return {
        tickers: {
          ...s.tickers,
          [symbol]: { ...prev, error: { ...prev.error, [key]: msg } },
        },
      };
    }),
}));
