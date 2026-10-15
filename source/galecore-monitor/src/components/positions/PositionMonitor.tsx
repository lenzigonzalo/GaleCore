import React, { useState, useEffect, useCallback, useRef } from 'react';
import { PortfolioRiskBar } from '../monitor/PortfolioRiskBar';
import { PositionCard } from '../monitor/PositionCard';
import { LivePositionRow, PositionRowData } from './PositionRow';
import { GammaExposureResponse } from '../../types/api';
import { LiveSpread } from '../../types/position';
import { useAccountStore } from '../../store/useAccountStore';
import { useAppConfigStore } from '../../store/useAppConfigStore';
import { useMarketStore } from '../../store/useMarketStore';
import { buildLiveSpreads } from '../../utils/spreadBuilder';
import { buildStreamerSymbol, parseOccSymbol } from '../../utils/streamerSymbol';
import { fetchGammaExposure, fetchIVRank } from '../../api/analytics';
import { fetchPositions, fetchBalances, fetchSpreadRisk, AccountSpreadRisk } from '../../api/account';
import { ConnectionStatus } from '../../socket/useMarketSocket';

const REFRESH_INTERVAL_MS = 60_000; // Auto-refresh account positions every 60s

interface Props {
  subscribeLeg:   (sym: string) => void;
  unsubscribeLeg: (sym: string) => void;
  /** Subyacentes (sin Greeks). Distinto de subscribeLeg, que pide Greeks para las opciones. */
  subscribeSymbol:   (sym: string) => void;
  unsubscribeSymbol: (sym: string) => void;
  socketStatus:   ConnectionStatus;
}

export function PositionMonitor({ subscribeLeg, unsubscribeLeg, subscribeSymbol, unsubscribeSymbol, socketStatus }: Props) {
  const { config }         = useAppConfigStore();
  const { positions, setPositions, setBalances } = useAccountStore();
  const marketTickers      = useMarketStore(s => s.tickers);
  const setIVRank          = useMarketStore(s => s.setIVRank);

  const [gexData,    setGexData]    = useState<Record<string, GammaExposureResponse>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [risk, setRisk] = useState<Record<string, AccountSpreadRisk>>({});
  const subscribedLegsRef           = useRef<Set<string>>(new Set());

  // ── Rule thresholds ──────────────────────────────────────────────────────
  // Fuente: nodo `monitor` del config de la app. Monitor es transversal — muestra las posiciones
  // abiertas de la cuenta sin importar qué estrategia las abrió, así que sus umbrales de gestión
  // son de la plataforma, no de una estrategia.
  const tm = config?.monitor?.trade_management;
  const ruleThresholds = {
    takeProfitPct: tm?.take_profit?.pct_of_initial_credit ?? 0.5,
    stopLossPct:   tm?.hard_defense?.trigger_any?.unrealized_loss_pct_of_initial_credit_gte ?? 2.0,
    rollTrigPct:   tm?.defensive_roll?.trigger_unrealized_loss_pct_of_initial_credit_gte ?? 1.0,
    rollMinDte:    tm?.defensive_roll?.min_dte_remaining ?? 28,
    timeExitDte:   tm?.time_exit?.dte_threshold ?? 21,
  };

  // ── Build live spreads from account positions ────────────────────────────
  const spreads: LiveSpread[] = buildLiveSpreads(positions, marketTickers as any, ruleThresholds);

  // ── Subscribe / unsubscribe leg symbols ─────────────────────────────────
  useEffect(() => {
    if (socketStatus !== 'connected') {
      subscribedLegsRef.current.clear();
      return;
    }

    const neededLegs = new Set<string>();
    positions.filter(p => p.quantity !== 0 && p.instrumentType !== 'Equity').forEach(p => {
      const option = parseOccSymbol(p.symbol);
      if (option) neededLegs.add(buildStreamerSymbol(option.underlying, option.expiration, option.side, option.strike));
    });

    // Subscribe new legs
    Array.from(neededLegs).forEach(sym => {
      if (!subscribedLegsRef.current.has(sym)) {
        subscribeLeg(sym);
        subscribedLegsRef.current.add(sym);
      }
    });

    // Unsubscribe legs no longer needed
    Array.from(subscribedLegsRef.current).forEach(sym => {
      if (!neededLegs.has(sym)) {
        unsubscribeLeg(sym);
        subscribedLegsRef.current.delete(sym);
      }
    });
  });

  // Cleanup all subscriptions on unmount
  useEffect(() => {
    // Se captura el Set al montar: el cleanup corre cuando `subscribedLegsRef.current` ya podría
    // apuntar a otra cosa. Acá el ref nunca se reasigna, así que es el mismo objeto — pero leerlo
    // dentro del cleanup es el patrón que rompe cuando alguien sí lo reasigna.
    const subscribed = subscribedLegsRef.current;
    return () => {
      Array.from(subscribed).forEach(sym => unsubscribeLeg(sym));
      subscribed.clear();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Suscribir los SUBYACENTES de las posiciones ──────────────────────────
  // El Monitor lee el spot de useMarketStore, pero hasta 2026-08-10 no suscribía ningún subyacente:
  // solo las patas. Con SPY y QQQ no se notaba porque los suscribe la plataforma (universe.tickers
  // del config de app); con cualquier otro símbolo el spot venía de que la pantalla de GEX lo
  // suscribiera como "extra" — y GEX se monta recién al entrar a su pestaña.
  //
  // O sea: el spot de una posición en SKM dependía de haber visitado GEX. El Monitor es TRANSVERSAL
  // a las estrategias (CLAUDE.md) y no puede depender de ninguna. Se hizo evidente al gatear las
  // suscripciones de GEX por su switch: apagar una estrategia informativa se llevaba puesto el
  // precio de una posición abierta.
  const underlyingsKey = Array.from(new Set(positions.filter(p => p.quantity !== 0)
    .map(p => p.underlyingSymbol || (p.instrumentType === 'Equity' ? p.symbol : parseOccSymbol(p.symbol)?.underlying))
    .filter((symbol): symbol is string => !!symbol))).sort().join(',');
  useEffect(() => {
    if (socketStatus !== 'connected' || !underlyingsKey) return;
    const syms = underlyingsKey.split(',');
    syms.forEach(subscribeSymbol);
    return () => syms.forEach(unsubscribeSymbol);
  }, [underlyingsKey, socketStatus, subscribeSymbol, unsubscribeSymbol]);

  // ── Fetch GEX walls + IV Rank for unique tickers ────────────────────────
  useEffect(() => {
    const tickers = Array.from(new Set(spreads.map(s => s.underlyingSymbol)));
    tickers.forEach(sym => {
      if (!gexData[sym]) {
        fetchGammaExposure(sym)
          .then(data => setGexData(prev => ({ ...prev, [sym]: data })))
          .catch(() => {});
      }
      if (marketTickers[sym]?.ivRank == null) {
        fetchIVRank(sym)
          .then(data => setIVRank(sym, data.ivRank))
          .catch(() => {});
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spreads.map(s => s.underlyingSymbol).join(',')]);

  // ── Manual + auto refresh ────────────────────────────────────────────────
  const doRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [pos, bal] = await Promise.all([fetchPositions(), fetchBalances()]);
      setPositions(pos);
      setBalances(bal);
    } catch { /* ignore */ }
    finally { setRefreshing(false); }
    // Pérdida máxima, POP y griegas netas los calcula la API; si falla, quedan sin dato («—»).
    fetchSpreadRisk().then(setRisk).catch(() => {});
  }, [setPositions, setBalances]);

  useEffect(() => { fetchSpreadRisk().then(setRisk).catch(() => {}); }, []);

  // Auto-refresh every 60s
  useEffect(() => {
    const id = setInterval(doRefresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [doRefresh]);

  // ── Render: Cartera (14/10) — resumen arriba, una fila por posición; el monitor detallado al hacer clic.
  const current = spreads.find(s => s.id === selected) ?? null;
  return (
    <div className="cartera-page">
      <PortfolioRiskBar spreads={spreads} risk={risk} onRefresh={doRefresh} refreshing={refreshing} />
      <div className="cartera-body">
        {current ? <>
          <button className="shadow-back" onClick={() => setSelected(null)}>← Cartera</button>
          <PositionCard spread={current} risk={risk[current.id]} gexData={gexData} />
        </> : <>
          {spreads.length === 0 && <p className="cartera-empty">{positions.length === 0
            ? 'Sin posiciones abiertas en la cuenta.'
            : 'Las posiciones de la cuenta no forman spreads reconocidos (put o call credit spread, iron condor).'}</p>}
          <div className="cartera-rows">{spreads.map(s => <div key={s.id} className="cartera-row" role="button" tabIndex={0} aria-label={'Abrir ' + s.underlyingSymbol + ' ' + s.expiration}
            onClick={() => setSelected(s.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(s.id); } }}>
            <LivePositionRow position={toRow(s)} /></div>)}</div>
        </>}
      </div>
    </div>
  );
}

const STRUCTURES: Record<string, string> = { PUT_CS: 'put_credit_spread', CALL_CS: 'call_credit_spread', IC: 'iron_condor', LONG: 'long' };
function toRow(s: LiveSpread): PositionRowData {
  const legs = [
    s.longPutStrike != null && { side: 'BUY', type: 'PUT', strike: s.longPutStrike },
    s.shortPutStrike != null && { side: 'SELL', type: 'PUT', strike: s.shortPutStrike },
    s.shortCallStrike != null && { side: 'SELL', type: 'CALL', strike: s.shortCallStrike },
    s.longCallStrike != null && { side: 'BUY', type: 'CALL', strike: s.longCallStrike },
  ].filter(Boolean) as PositionRowData['legs'];
  return { structure: STRUCTURES[s.type] ?? s.type, symbol: s.underlyingSymbol, expiration: s.expiration, dte: s.dte, legs, entryAt: null,
    credit: s.initialCredit, currentValue: s.hasLiveQuote ? s.currentNetCredit ?? null : null, pnl: s.hasLiveQuote ? s.currentPnl ?? null : null, risk: null,
    reason: s.hasLiveQuote ? null : 'Sin cotización en vivo' };
}
