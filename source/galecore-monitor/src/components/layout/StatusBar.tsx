import React, { useEffect, useState } from 'react';
import { PanelRightOpen } from 'lucide-react';
import { fmtTime, MARKET_TZ } from '../../utils/formatters';
import { isAuthUnverified } from '../../utils/authState';
import { ConnectionStatus } from '../../socket/useMarketSocket';
import { useMarketStore } from '../../store/useMarketStore';
import { useGexStore } from '../../store/useGexStore';
import { useAppConfigStore } from '../../store/useAppConfigStore';
import { TickerState } from '../../types/market';
import './StatusBar.css';

/** Horario regular ET; dentro del horario sólo se confirma apertura con señal reciente del proveedor. */
export function regularSessionLabel(now:Date, ticker:TickerState|undefined, connected:boolean):string {
  const day=now.toLocaleDateString('en-US',{timeZone:MARKET_TZ,weekday:'short'});
  const time=fmtTime(now).split(':').map(Number);
  const minutes=time[0]*60+time[1];
  if (day === 'Sat' || day === 'Sun' || minutes < 570 || minutes >= 960) return 'Rueda regular cerrada';
  const statusTime=ticker?.marketStatusReceivedAt;
  const sourceTime=ticker?.marketStatusSourceAt;
  if (!connected || !statusTime || !sourceTime || !Number.isFinite(sourceTime.getTime()) || sourceTime.getTime() > now.getTime() || now.getTime()-sourceTime.getTime() > 60000 || now.getTime()-statusTime.getTime() > 60000) return 'Apertura sin confirmar';
  return ticker?.extendedTradingHours === false ? 'Rueda regular abierta' : ticker?.extendedTradingHours === true ? 'Fuera de rueda regular' : 'Apertura sin confirmar';
}
export function StatusBar({ connectionStatus, lastUpdate, onWatchlist, watchlistOpen = false }: {
  connectionStatus:ConnectionStatus; lastUpdate:Date|null; onWatchlist?:()=>void; watchlistOpen?:boolean;
}) {
  const [now,setNow]=useState(new Date());
  useEffect(() => {const timer=setInterval(()=>setNow(new Date()),1000);return()=>clearInterval(timer);},[]);
  const selected=useGexStore(s=>s.selectedSymbol);
  const universe=useAppConfigStore(s=>s.tickers);
  const symbol=selected ?? universe[0];
  const ticker=useMarketStore(s=>symbol ? s.tickers[symbol] : undefined);
  const connected=connectionStatus === 'connected';
  const available=!!ticker && ticker.price > 0 && !ticker.error.price && !!ticker.lastUpdate;
  const recent=available && now.getTime()-ticker!.lastUpdate!.getTime() <= 60000;
  const session=regularSessionLabel(now,ticker,connected);
  return <header className="gc-status-bar">
    <div className="gc-status-info">
      {isAuthUnverified() && <span className="gc-status-warning">Clave sin validar</span>}
      <span className={'gc-connection ' + (connected ? 'connected' : '')}><i/>{connected ? 'GaleCore conectado' : connectionStatus === 'connecting' ? 'Conectando…' : 'Sin conexión'}</span>
      <span className="gc-market-session" title="Rueda regular de acciones de EE. UU. en ET. Dentro del horario, requiere señal reciente del proveedor; no se deducen feriados desde el reloj.">{session}</span>
      <span className={available ? 'gc-price-status' : 'gc-status-warning'} title="Recepción en el monitor, no hora de origen ni garantía de tiempo real.">{symbol || 'Cotizaciones'} · {available ? (recent ? 'datos recibidos ' : 'última lectura ') + fmtTime(ticker!.lastUpdate!) : ticker?.error.price ? 'datos no disponibles' : 'sin cotización recibida'}</span>
      {lastUpdate && <span className="gc-account-status">Cuenta {fmtTime(lastUpdate)}</span>}
    </div>
    <div className="gc-status-actions"><div className="gc-clock"><time dateTime={now.toISOString()}>{fmtTime(now)}</time><span>ET</span></div>
      {onWatchlist && <button className="gc-watchlist-trigger" aria-expanded={watchlistOpen} aria-controls="lw-panel" onClick={onWatchlist}><PanelRightOpen size={19}/>Watchlist</button>}
    </div>
  </header>;
}
