import React, { useEffect, useState } from 'react';
import { fmtTime } from '../../utils/formatters';
import { isAuthUnverified } from '../../utils/authState';
import { ConnectionStatus } from '../../socket/useMarketSocket';
import { useMarketStore } from '../../store/useMarketStore';
import { useGexStore } from '../../store/useGexStore';
import { useAppConfigStore } from '../../store/useAppConfigStore';
import { regularSessionLabel } from '../../utils/marketSession';
import './StatusBar.css';
export { regularSessionLabel } from '../../utils/marketSession';

export function StatusBar({ connectionStatus, lastUpdate }: {
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
  return <div className="gc-inline-status">
    {isAuthUnverified() && <span className="gc-status-warning" title="La autenticación todavía no pudo validarse.">Sin validar</span>}
    <span className={'gc-connection ' + (connected ? 'connected' : '')} title={session + ' · ' + (symbol || 'Cotizaciones') + ': ' + (available ? (recent ? 'datos recibidos ' : 'última lectura ') + fmtTime(ticker!.lastUpdate!) : 'sin datos disponibles') + (lastUpdate ? ' · Cuenta ' + fmtTime(lastUpdate) : '')}><i/>{connected ? 'Online' : connectionStatus === 'connecting' ? 'Conectando' : 'Offline'}</span>
    <div className="gc-clock" title="Hora de Argentina (UTC−3)"><time dateTime={now.toISOString()}>{now.toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time><span>ARG</span></div>
  </div>;
}
