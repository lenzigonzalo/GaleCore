import React, { useEffect, useRef } from 'react';
import { TickerCard } from './TickerCard';
import { TickerWatchlist } from './TickerWatchlist';
import { useMarketStore } from '../../store/useMarketStore';
import { fetchMarketDataBatch } from '../../api/marketdata';

interface Props {
  layout?: 'cards' | 'list';
  selectedSymbol: string | null;
  onSelect: (symbol: string | null) => void;
  /** Universo a mostrar. Lo pasa la estrategia dueña de la pantalla, desde su propio JSON de
   *  reglas: la grilla no conoce ningún universo por defecto. */
  symbols: string[];
  loading?: boolean;
  error?: string | null;
  /** Card extra al final de la grilla (hoy: el buscador de símbolos de GEX). */
  trailing?: React.ReactNode;
  /** Los que se pueden sacar de la grilla. La grilla no sabe por qué uno lo es y otro no. */
  removableSymbols?: string[];
  onRemoveSymbol?: (symbol: string) => void;
}

function applyMarketData(d: { symbol: string; open: number; prevClose?: number; volume: number; last: number; bid: number; ask: number }) {
  const store = useMarketStore.getState();
  store.setOpen(d.symbol, d.open, d.prevClose, d.volume);
  if (!store.tickers[d.symbol]?.price) {
    store.updatePrice(d.symbol, { price: d.last, size: 0, timestamp: new Date().toISOString() });
  }
  store.updateQuote(d.symbol, { bidPrice: d.bid, askPrice: d.ask, timestamp: new Date().toISOString() });
}

export function TickerGrid({
  selectedSymbol, onSelect, symbols, loading, error,
  trailing, removableSymbols, onRemoveSymbol, layout = 'cards',
}: Props) {
  // El estado de carga es el de quien pasa el universo — la grilla no lo deriva de ningún store.
  const rulesLoading = loading ?? false;
  const rulesError = error ?? null;
  const marketStore = useMarketStore();
  const { tickers, initTicker, setLoading, setError } = marketStore;
  /** Qué símbolos ya se pidieron. NO es un booleano de "ya cargué": el universo cambia. */
  const loadedRef   = useRef<Set<string>>(new Set());
  const pollRef     = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Carga inicial por lote, solo del delta ────────────────────────────────
  // El guard era `loadedRef.current` booleano: con la primera lista cargada, cualquier universo
  // posterior entraba y salía sin pedir nada, y sus cards se quedaban en precio 0 hasta que
  // tickeara el socket. Con un universo fijo desde el arranque nunca se notó.
  useEffect(() => {
    // Lo que ya no se muestra sale del registro: si vuelve, su precio se vuelve a pedir en vez
    // de mostrarse el de la vez anterior. Se recorre con forEach y no con spread porque el
    // target del tsconfig es es5, donde iterar un Set exige downlevelIteration.
    const stillShown = new Set<string>();
    loadedRef.current.forEach((s) => { if (symbols.includes(s)) stillShown.add(s); });
    loadedRef.current = stillShown;

    const pending = symbols.filter((s) => !loadedRef.current.has(s));
    if (!pending.length) return;

    pending.forEach((s) => {
      loadedRef.current.add(s);
      initTicker(s);
      setLoading(s, 'price', true);
    });

    fetchMarketDataBatch(pending)
      .then((results) => {
        results.forEach(applyMarketData);
      })
      .catch((e) => {
        // Un símbolo que falló NO queda marcado como cargado: el próximo intento tiene que
        // volver a pedirlo, o queda en 0 para siempre.
        pending.forEach((s) => {
          loadedRef.current.delete(s);
          setError(s, 'price', e.message);
        });
      })
      .finally(() => {
        pending.forEach((s) => setLoading(s, 'price', false));
      });
  }, [symbols.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── REST fallback polling (single batch call) ─────────────────────────────
  useEffect(() => {
    const timer = setTimeout(() => {
      const noStream = symbols.filter((s) => !useMarketStore.getState().tickers[s]?.isStreaming);
      if (noStream.length && !pollRef.current) {
        pollRef.current = setInterval(() => {
          fetchMarketDataBatch(noStream)
            .then((results) => {
              results.forEach((d) => {
                useMarketStore.getState().updatePrice(d.symbol, { price: d.last, size: 0, timestamp: new Date().toISOString() });
              });
            })
            .catch(() => {});
        }, 30000);
      }
    }, 10000);
    return () => {
      clearTimeout(timer);
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [symbols.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  if (rulesLoading) {
    return (
      <div className="p-4 text-xs" style={{ color: 'var(--text-muted)' }}>
        Cargando tickers…
      </div>
    );
  }

  if (rulesError) {
    return (
      <div className="p-4 text-xs" style={{ color: 'var(--red-gc)' }}>
        Error cargando reglas: {rulesError}
      </div>
    );
  }

  // Sin universo, la grilla igual se dibuja si hay card extra: el buscador es justamente lo que
  // permite salir de un universo vacío.
  if (!symbols.length && !trailing) {
    return (
      <div className="p-4 text-xs" style={{ color: 'var(--text-muted)' }}>
        No hay tickers configurados
      </div>
    );
  }

  if (layout === 'list') return <>
    <TickerWatchlist tickers={symbols.map(symbol => tickers[symbol] ?? {
      symbol, price: 0, open: 0, bid: 0, ask: 0, lastUpdate: null, isStreaming: false,
      loading: { price: true, ivRank: true, iv: true, gex: false }, error: {},
    })} selectedSymbol={selectedSymbol} onSelect={onSelect}
      removableSymbols={removableSymbols} onRemoveSymbol={onRemoveSymbol} />
    {trailing}
  </>;

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))' }}>
      {symbols.map((symbol) => {
        const tickerState = tickers[symbol] ?? {
          symbol, price: 0, open: 0, bid: 0, ask: 0,
          lastUpdate: null, isStreaming: false,
          loading: { price: true, ivRank: true, iv: true, gex: false },
          error: {},
        };
        return (
          <TickerCard
            key={symbol}
            ticker={tickerState}
            selected={selectedSymbol === symbol}
            onClick={() => onSelect(selectedSymbol === symbol ? null : symbol)}
            onRemove={removableSymbols?.includes(symbol) && onRemoveSymbol
              ? () => onRemoveSymbol(symbol)
              : undefined}
          />
        );
      })}
      {trailing}
    </div>
  );
}
