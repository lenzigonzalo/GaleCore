import React, { useState } from 'react';
import { ArrowUpRight, ChevronRight, TriangleAlert } from 'lucide-react';
import { demoAccount, demoEquity } from './MainDemo.fixture';
import './MonitorOverview.css';

const money = (v: number) => '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** TEMPORAL GC-0011: cuenta/estrategias de ejemplo; GEX se muestra sólo en Mercado. */
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
  const y = (v: number) => 90 - (v - low) / (high - low) * 66;
  const x = (i: number) => 12 + i * 708 / (values.length - 1);
  const points = values.map((v, i) => x(i) + ',' + y(v)).join(' ');
  const selected = cursor === null ? values.length - 1 : Math.min(cursor, values.length - 1);
  const change = values[values.length - 1] - values[0];
  return <div className="mo-layout">
    <main className="mo-main">
      {!accountView && <div className="mo-top">
        <section className="mo-panel mo-equity">
          <header><span>{cursor === null ? 'Patrimonio total · USD' : 'Patrimonio en sesión ' + (selected + 1) + ' · USD'}</span></header>
          <div className="mo-value">{money(values[selected])}</div>
          <div className="mo-return"><span className="demo-positive">+{money(change)} · +{(change / values[0] * 100).toFixed(2)}%</span><span>{period + ' sesiones'}</span></div>
          <div className="mo-chart">
            <svg viewBox="0 0 790 120" preserveAspectRatio="none" role="img" tabIndex={0} aria-label={'Curva de patrimonio ficticia en dólares. Usá las flechas para recorrer las ' + period + ' sesiones. Sesión ' + (selected+1) + ': ' + money(values[selected])}
              onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setCursor(Math.max(0,Math.min(values.length-1,selected+(e.key === 'ArrowLeft' ? -1 : 1)))); } if (e.key === 'Escape') setCursor(null); }}
              onPointerMove={e => { const bounds = e.currentTarget.getBoundingClientRect(); setCursor(Math.max(0, Math.min(values.length - 1, Math.round(((e.clientX - bounds.left) / bounds.width * 790 - 12) / 708 * (values.length - 1))))); }}
              onPointerLeave={() => setCursor(null)}>
              <defs><linearGradient id="mo-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity=".18"/><stop offset="1" stopColor="var(--accent)" stopOpacity="0"/></linearGradient></defs>
              {[0, .5, 1].map(f => <g key={f}><line x1="12" x2="720" y1={y(low + (high-low)*f)} y2={y(low + (high-low)*f)} stroke="var(--border-dark)" strokeDasharray="3 5"/></g>)}
              <polygon points={'12,90 ' + points + ' 720,90'} fill="url(#mo-fill)"/>
              <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="2.5" vectorEffect="non-scaling-stroke"/>
              {cursor !== null && <line x1={x(selected)} x2={x(selected)} y1="14" y2="90" stroke="var(--text-muted)" strokeDasharray="3 4"/>}
              <circle cx={x(selected)} cy={y(values[selected])} r="4" fill="var(--accent)"/>

            </svg>
            {[0,.5,1].map(f => <span aria-hidden="true" className="mo-chart-axis" key={f} style={{top:y(low+(high-low)*f)/120*100+'%'}}>{Math.round((low+(high-low)*f)/1000)}k</span>)}
          </div>
          <footer><div className="demo-periods">{([5,20,60] as const).map(n => <button key={n} aria-pressed={period === n} onClick={() => { setPeriod(n); setCursor(null); }}>{n === 5 ? '1S' : n === 20 ? '1M' : '3M'}</button>)}</div><span>Patrimonio · incluye efectivo</span></footer>
        </section>
        <section className="mo-panel mo-account"><header><h2>Cuenta y distribución</h2><span>USD</span></header>
          <div className="mo-account-metrics">
            <div><span>Patrimonio</span><strong>{money(demoAccount.netLiq)}</strong></div>
            <div><span>P&L abierto</span><strong className="demo-positive">+{money(demoAccount.openPnl)}</strong></div>
            <div><span>Efectivo</span><strong>{money(demoAccount.cash)}</strong></div>
            <div><span>Poder de compra</span><strong>{money(demoAccount.buyingPower)}</strong></div>
          </div>
          <div className="mo-allocation"><h3>Capital asignado</h3><div className="mo-allocation-bar">{[44,31,25].map((n,i) => <i key={n} style={{width:n+'%',background:['var(--accent)','#8eaac6','#c6ae80'][i]}}/>)}</div>
            {['SPY Income','QQQ Neutral','IWM Range'].map((name,i) => <button key={name} onClick={() => onStrategy(name)}><span><i style={{background:['var(--accent)','#8eaac6','#c6ae80'][i]}}/>{name}</span><strong>{[44,31,25][i]}%</strong></button>)}

          </div>
        </section>
      </div>}
      <div className="mo-panel mo-positions">{positions}</div>
      {accountView && <section className="mo-panel portfolio-exposure"><header><h2>Distribución de cartera</h2><span>Capital</span></header><div className="portfolio-exposure-grid"><div className="portfolio-donut-group"><div className="portfolio-donut" role="img" aria-label="Capital asignado por estrategia: SPY 44%, QQQ 31%, IWM 25%"><div><strong>3</strong><span>Estrategias</span></div></div><div className="portfolio-legend">{['SPY Income','QQQ Neutral','IWM Range'].map((name,i) => <button key={name} onClick={() => onStrategy(name)}><span><i style={{background:['var(--accent)','#8eaac6','#c6ae80'][i]}}/>{name}</span><strong>{[44,31,25][i]}%</strong></button>)}</div></div><div className="portfolio-liquidity"><h3>Liquidez</h3><strong>{(demoAccount.cash/demoAccount.netLiq*100).toFixed(1)}%<span> en efectivo</span></strong><div className="portfolio-liquidity-bar"><i style={{width:demoAccount.cash/demoAccount.netLiq*100+'%'}}/></div><dl><dt>Efectivo</dt><dd>{money(demoAccount.cash)}</dd><dt>Poder de compra</dt><dd>{money(demoAccount.buyingPower)}</dd><dt>Patrimonio</dt><dd>{money(demoAccount.netLiq)}</dd></dl></div></div></section>}
    </main>
    <aside className="mo-rail" aria-label="Seguimiento y agenda">
      <section className="mo-panel mo-followup mo-alerts-priority" aria-label="Atención requerida">
        <header><h2><TriangleAlert size={17} aria-hidden="true"/>Atención requerida</h2><span className="mo-alert-count">2</span></header>
        {/* Prioridades ilustrativas del prototipo; no calculan riesgo ni ejecutan acciones. */}
        <button className="mo-attention mo-alert-row alert-critical" onClick={() => onStrategy('QQQ Neutral',true)}>
          <span className="mo-severity-badge">31<span>%</span></span>
          <span className="mo-alert-copy"><strong>QQQ Neutral · Concentración</strong><small>Capital asignado · IC · 16 DTE</small></span>
          <span className="mo-alert-action">Revisar<ChevronRight size={16}/></span>
        </button>
        <button className="mo-attention mo-alert-row alert-warning" onClick={() => onStrategy('SPY Income',true)}>
          <span className="mo-severity-badge">2<span>DTE</span></span>
          <span className="mo-alert-copy"><strong>SPY Income · Vencimiento</strong><small>PCS · 600 / 595 · ×2</small></span>
          <span className="mo-alert-action">Ver salida<ChevronRight size={16}/></span>
        </button>
      </section>
      <section className="mo-panel mo-agenda"><header><h2>Agenda</h2><span>ET</span></header>
        <button onClick={() => onMarket('SPY')}><span className="mo-agenda-time">Mañana<strong>08:30</strong></span><div><strong>Inflación de EE. UU.</strong><small>SPY · QQQ · IWM</small></div><ArrowUpRight size={16}/></button>
        <button onClick={() => onStrategy('SPY Income')}><span className="mo-agenda-time">En 2 días<strong>16:00</strong></span><div><strong>SPY Income</strong><small>Vencimiento · 2 contratos</small></div><ArrowUpRight size={16}/></button>
        <button onClick={() => onStrategy('QQQ Neutral')}><span className="mo-agenda-time">En 16 días<strong>16:00</strong></span><div><strong>QQQ Neutral</strong><small>Vencimiento · 1 contrato</small></div><ArrowUpRight size={16}/></button>
      </section>
    </aside>
  </div>;
}
