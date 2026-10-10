import React, { useState } from 'react';
import { ArrowUpRight, ChevronRight } from 'lucide-react';
import { demoAccount, demoEquity, demoWatchlist } from './MainDemo.fixture';
import './MonitorOverview.css';

const money = (v: number) => '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** TEMPORAL GC-0011: composición de Monitor con datos de ejemplo, sin servicios. */
export function MonitorOverview({ positions, onStrategy, onMarket, accountView = false }: {
  positions: React.ReactNode;
  accountView?: boolean;
  onStrategy: (name: string, investigate?: boolean) => void;
  onMarket: (symbol: string) => void;
}) {
  const [period, setPeriod] = useState<5 | 20 | 60>(20);
  const [cursor, setCursor] = useState<number | null>(null);
  const values = demoEquity.slice(-period);
  const low = Math.floor(Math.min(...values) / 1000) * 1000 - 500;
  const high = Math.ceil(Math.max(...values) / 1000) * 1000 + 500;
  const y = (v: number) => 218 - (v - low) / (high - low) * 192;
  const x = (i: number) => 12 + i * 708 / (values.length - 1);
  const points = values.map((v, i) => x(i) + ',' + y(v)).join(' ');
  const selected = cursor === null ? values.length - 1 : Math.min(cursor, values.length - 1);
  const change = values[values.length - 1] - values[0];
  const monthValues = demoEquity.slice(-20);
  const sessionPnl = monthValues.map((v,i) => i === 0 ? null : v-monthValues[i-1]);
  return <div className="mo-layout">
    <main className="mo-main">
      <div className="mo-top">
        <section className="mo-panel mo-equity">
          <header><span>{cursor === null ? 'Patrimonio total · USD' : 'Patrimonio en sesión ' + (selected + 1) + ' · USD'}</span><span className="mo-live">Cuenta de ejemplo</span></header>
          <div className="mo-value">{money(values[selected])}</div>
          <div className="mo-return"><span className="demo-positive">+{money(change)} · +{(change / values[0] * 100).toFixed(2)}%</span><span>{period + ' sesiones'}</span></div>
          <div className="mo-chart">
            <svg viewBox="0 0 790 246" preserveAspectRatio="none" role="img" tabIndex={0} aria-label={'Curva de patrimonio ficticia en dólares. Usá las flechas para recorrer las ' + period + ' sesiones. Sesión ' + (selected+1) + ': ' + money(values[selected])}
              onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setCursor(Math.max(0,Math.min(values.length-1,selected+(e.key === 'ArrowLeft' ? -1 : 1)))); } if (e.key === 'Escape') setCursor(null); }}
              onPointerMove={e => { const bounds = e.currentTarget.getBoundingClientRect(); setCursor(Math.max(0, Math.min(values.length - 1, Math.round(((e.clientX - bounds.left) / bounds.width * 790 - 12) / 708 * (values.length - 1))))); }}
              onPointerLeave={() => setCursor(null)}>
              <defs><linearGradient id="mo-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity=".18"/><stop offset="1" stopColor="var(--accent)" stopOpacity="0"/></linearGradient></defs>
              {[0, .5, 1].map(f => <g key={f}><line x1="12" x2="720" y1={y(low + (high-low)*f)} y2={y(low + (high-low)*f)} stroke="var(--border-dark)" strokeDasharray="3 5"/><text x="735" y={y(low + (high-low)*f)+4}>{Math.round((low+(high-low)*f)/1000)}k</text></g>)}
              <polygon points={'12,218 ' + points + ' 720,218'} fill="url(#mo-fill)"/>
              <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="2.5" vectorEffect="non-scaling-stroke"/>
              {cursor !== null && <line x1={x(selected)} x2={x(selected)} y1="20" y2="218" stroke="var(--text-muted)" strokeDasharray="3 4"/>}
              <circle cx={x(selected)} cy={y(values[selected])} r="4" fill="var(--accent)"/>
              <text x="12" y="242">Sesión 1</text><text x="720" y="242" textAnchor="end">Sesión {period}</text>
            </svg>
          </div>
          <footer><div className="demo-periods">{([5,20,60] as const).map(n => <button key={n} aria-pressed={period === n} onClick={() => { setPeriod(n); setCursor(null); }}>{n === 5 ? '1S' : n === 20 ? '1M' : '3M'}</button>)}</div><span>Patrimonio · incluye efectivo</span></footer>
        </section>
        <section className="mo-panel mo-account"><header><h2>Cuenta y distribución</h2><span>USD</span></header>
          <div className="mo-account-metrics">
            <div><span>P&L hoy</span><strong className="demo-positive">+{money(demoAccount.dailyPnl)}</strong><small>+0,66% · vs. cierre anterior</small></div>
            <div><span>P&L abierto</span><strong className="demo-positive">+{money(demoAccount.openPnl)}</strong><small>3 posiciones · 5 contratos</small></div>
            <div><span>Efectivo</span><strong>{money(demoAccount.cash)}</strong></div>
            <div><span>Poder de compra</span><strong>{money(demoAccount.buyingPower)}</strong></div>
          </div>
          <div className="mo-allocation"><h3>Capital asignado</h3><div className="mo-allocation-bar">{[44,31,25].map((n,i) => <i key={n} style={{width:n+'%',background:['var(--accent)','#8eaac6','#c6ae80'][i]}}/>)}</div>
            {['SPY Income','QQQ Neutral','IWM Range'].map((name,i) => <button key={name} onClick={() => onStrategy(name)}><span><i style={{background:['var(--accent)','#8eaac6','#c6ae80'][i]}}/>{name}</span><strong>{[44,31,25][i]}%</strong></button>)}
            <small>Distribución de ejemplo sobre capital asignado.</small>
          </div>
        </section>
      </div>
      <div className="mo-panel mo-positions">{positions}</div>
      {accountView ? <section className="mo-panel"><header><h2>Saldos de la cuenta</h2><span>Lectura de ejemplo · 14:35 ET</span></header><div className="mo-account-metrics"><div><span>Realizado hoy</span><strong className="demo-positive">+{money(demoAccount.realizedToday)}</strong></div><div><span>No realizado</span><strong className="demo-positive">+{money(demoAccount.openPnl)}</strong></div><div><span>Efectivo / patrimonio</span><strong>{(demoAccount.cash/demoAccount.netLiq*100).toFixed(1)}%</strong></div><div><span>Moneda base</span><strong>USD</strong></div></div><p className="demo-secondary" style={{marginTop:14}}>El poder de compra es una lectura del broker; no se suma al patrimonio.</p></section> : <div className="mo-bottom">
        <section className="mo-panel"><header><h2>Atención requerida</h2><span className="mo-count">2</span></header>
          <button className="mo-attention" onClick={() => onStrategy('SPY Income', true)}><span className="mo-tag demo-warning">2 DTE</span><div><strong>SPY Income · revisar salida</strong><p>Ganancia abierta de $340. Vence en 2 días.</p><small>Supervisor de posiciones · 14:32 ET</small></div><ChevronRight size={16}/></button>
          <button className="mo-attention" onClick={() => onStrategy('QQQ Neutral', true)}><span className="mo-tag">31%</span><div><strong>QQQ Neutral · capital concentrado</strong><p>Revisar distribución antes de aumentar el tamaño.</p><small>Supervisor de riesgo · 14:20 ET</small></div><ChevronRight size={16}/></button>
        </section>
        <section className="mo-panel"><header><h2>P&L por sesión</h2><span>1M · 20 sesiones</span></header><div className="mo-calendar">{sessionPnl.map((v,i) => <div key={i} className={v !== null && v > 0 ? "gain" : v !== null && v < 0 ? "loss" : ""}><span>S{i+1}</span><strong>{v === null ? "Base" : (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(0)}</strong></div>)}</div><footer className="demo-table-footer"><span>USD redondeados · primera sesión como base</span><strong className="demo-positive">+{money(monthValues[19]-monthValues[0])}</strong></footer></section>
      </div>}
    </main>
    <aside className="mo-rail" aria-label="Watchlist">
      <section className="mo-panel"><header><h2>Watchlist</h2><span>14:35 ET</span></header>
        <table><thead><tr><th>Activo</th><th>Precio</th><th>Hoy</th></tr></thead><tbody>{demoWatchlist.map(t => <tr key={t.symbol}><td><button aria-label={'Analizar '+t.symbol} onClick={() => onMarket(t.symbol)}>{t.symbol}</button></td><td>{t.price.toFixed(2)}</td><td className={t.change >= 0 ? 'demo-positive' : 'demo-negative'}>{t.change > 0 ? '+' : ''}{t.change.toFixed(2)}%</td></tr>)}</tbody></table>
      </section>
      <section className="mo-panel mo-agenda"><header><h2>Agenda</h2><span>ET</span></header>
        <button onClick={() => onMarket('SPY')}><span>Mañana · 08:30</span><strong>Inflación de EE. UU.</strong><small>SPY · QQQ · IWM</small><ArrowUpRight size={15}/></button>
        <button onClick={() => onStrategy('SPY Income')}><span>En 2 días · 16:00</span><strong>Vencimiento SPY Income</strong><small>2 contratos · put spread</small><ArrowUpRight size={15}/></button>
      </section>
      <section className="mo-panel mo-macro"><header><h2>Pulso de mercado</h2></header><div><span>VIX</span><strong>18,42</strong><small className="demo-positive">−0,68</small></div><div><span>UST 10Y</span><strong>4,28%</strong><small>−4 pb</small></div><p>Tasas en baja; el próximo dato de inflación concentra la atención.</p><small>Contexto de ejemplo · 08:12 ET</small></section>
    </aside>
  </div>;
}
