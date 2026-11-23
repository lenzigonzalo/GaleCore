import React, { useEffect, useState } from 'react';
import { fmtTime } from '../../utils/formatters';
import { isAuthUnverified } from '../../utils/authState';
import { ConnectionStatus } from '../../socket/useMarketSocket';
import { useMarketStore } from '../../store/useMarketStore';
import { useGexStore } from '../../store/useGexStore';
import { useAppConfigStore } from '../../store/useAppConfigStore';
import { regularSessionLabel, regularSessionCountdown, fmtRemaining } from '../../utils/marketSession';
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
  const cd=regularSessionCountdown(now);
  const argHm=(d:Date)=>d.toLocaleTimeString('es-AR',{timeZone:'America/Argentina/Buenos_Aires',hourCycle:'h23',hour:'2-digit',minute:'2-digit'});
  const rem=fmtRemaining(cd.remainingMs);
  return <div className="gc-inline-status">
    {isAuthUnverified() && <span className="gc-status-warning" title="La autenticación todavía no pudo validarse.">Sin validar</span>}
    <span className={'gc-connection ' + (connected ? 'connected' : '')} title={session + ' · ' + (symbol || 'Cotizaciones') + ': ' + (available ? (recent ? 'datos recibidos ' : 'última lectura ') + fmtTime(ticker!.lastUpdate!) : 'sin datos disponibles') + (lastUpdate ? ' · Cuenta ' + fmtTime(lastUpdate) : '')}><i/>{connected ? 'Online' : connectionStatus === 'connecting' ? 'Conectando' : 'Offline'}</span>
    <div className="gc-clock-box">
      <div className="gc-clock" title="Hora de Argentina (UTC−3)"><time dateTime={now.toISOString()}>{now.toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time><span>ARG</span></div>
      <div className="gc-session-line" title={'Rueda regular de NYSE: abre ' + argHm(cd.opensAt) + ' y cierra ' + argHm(cd.closesAt) + ' (hora de Argentina). No contempla feriados.'}>{cd.open ? 'cierra' : 'abre'} en {rem}</div>
    </div>
  </div>;
}
