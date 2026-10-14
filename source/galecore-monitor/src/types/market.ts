export interface TickerState {
  symbol: string;
  price: number;
  open: number;
  prevClose?: number; // previous session close — basis for daily change
  bid: number;
  ask: number;
  volume?: number;
  lastUpdate: Date | null;
  lastQuoteReceivedAt?: Date;
  isStreaming: boolean;
  lastTradeReceivedAt?: Date; // recepción del último trade válido; suscripción no implica precio reciente
  extendedTradingHours?: boolean;
  marketStatusSourceAt?: Date; // timestamp de origen del trade con señal de sesión
  marketStatusReceivedAt?: Date; // recepción de la señal de sesión del proveedor, separada de quotes/REST
  ivRank?: number;
  iv30?: number;
  iv9d?: number;
  iv3m?: number;
  // Per-option Greeks (live from DXLink via ReceiveGreeks) — present for option legs
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  iv?: number;     // implied volatility of this contract (DXLink "volatility")
  loading: {
    price: boolean;
    ivRank: boolean;
    iv: boolean;
    gex: boolean;
  };
  error: {
    price?: string;
    ivRank?: string;
    iv?: string;
    gex?: string;
  };
}
