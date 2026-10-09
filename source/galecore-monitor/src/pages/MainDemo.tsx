import React, { useState } from 'react';
import { ArrowUpRight, ChevronRight, X } from 'lucide-react';
import { demoAccount, demoWatchlist, demoPositions, demoAlerts, demoEquity } from './MainDemo.fixture';
import { fmtPnl, fmtPrice } from '../utils/formatters';
import './MainDemo.css';

/** TEMPORAL: fixtures aisladas para revisar UX; retirar según GC-0011. */
export function MainDemo({ onExit }: { onExit: () => void }) {
  const [symbol, setSymbol] = useState('SPY');
  const [period, setPeriod] = useState<5 | 20 | 60>(20);
  const [detail, setDetail] = useState<{ title: string; text: string } | null>(null);
  const values = demoEquity.slice(-period);
  const low = Math.min(...values) - 250, high = Math.max(...values) + 250;
  const line = values.map((v, i) => (8 + i * 724 / (values.length - 1)) + ',' + (100 - (v - low) * 90 / (high - low))).join(' ');
  const money = (v: number) => '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pnl = (v: number) => <span className={v >= 0 ? 'demo-positive' : 'demo-negative'}>{fmtPnl(v)}</span>;
  const inspect = (title: string, text: string) => setDetail({ title, text });
  const active = demoWatchlist.find(t => t.symbol === symbol)!;
  const jump = (label: string, text: string) => <button className="demo-jump" aria-label={'Ver detalle demo de ' + label} onClick={() => inspect(label, text)}><ArrowUpRight size={16} /></button>;
  return <div className="main-demo">
    <section className="demo-capital" aria-label="Resumen de cuenta">
      <button onClick={() => inspect('Cuenta', 'Resumen de capital, efectivo y poder de compra.')}><span>Valor de la cuenta</span><strong>{money(demoAccount.netLiq)}</strong></button>
      <button onClick={() => inspect('P&L del día', 'Realizado: ' + money(demoAccount.realizedToday) + '. Resultado abierto: ' + money(demoAccount.openPnl) + '.')}><span>P&amp;L hoy</span><strong>{pnl(demoAccount.dailyPnl)}</strong><small className="demo-positive">+0.66%</small></button>
      <button onClick={() => inspect('Efectivo', 'Saldo de efectivo disponible.')}><span>Efectivo</span><strong>{money(demoAccount.cash)}</strong></button>
      <button onClick={() => inspect('Poder de compra', 'Capacidad de compra informada por la cuenta.')}><span>Poder de compra</span><strong>{money(demoAccount.buyingPower)}</strong></button>
      <button onClick={() => inspect('P&L abierto', 'Resultado de las tres posiciones abiertas.')}><span>P&amp;L abierto</span><strong>{pnl(demoAccount.openPnl)}</strong></button>
      <div className="demo-mode"><span>Datos demo</span><button onClick={onExit}>Ver cuenta real<ArrowUpRight size={13} /></button></div>
    </section>
    <div className="demo-grid">
      <div className="demo-center">
        <section className="demo-attention"><header><h2>Para revisar <span>3</span></h2>{jump('Avisos', 'Vencimientos, concentración y próximos eventos.')}</header>
          <div className="demo-alerts">{demoAlerts.map((a, i) => <button key={a.label} className={'demo-alert ' + a.tone} onClick={() => { setSymbol(a.symbol); inspect(a.symbol + ' · ' + a.label, a.detail); }}><span className="demo-alert-marker">{i === 0 ? '2d' : i === 1 ? '31%' : '08:30'}</span><div><strong>{i === 0 ? 'SPY vence en 2 días' : i === 1 ? 'Concentración en QQQ' : 'Inflación mañana'}</strong><p>{a.detail}</p><small>{i === 0 ? 'SPY Income' : i === 1 ? 'QQQ Neutral' : 'Agenda de mercado'} · {a.time}</small></div><ChevronRight size={14} /></button>)}</div>
        </section>
        <section className="demo-positions"><header><h2>Posiciones abiertas <span>3</span></h2>{jump('Posiciones', 'Detalle de posiciones y estrategia vinculada.')}</header>
          <div className="demo-table-wrap"><table><thead><tr><th>Activo / patas</th><th>Estrategia</th><th>Contratos</th><th>Vence en</th><th>Valor spread</th><th>P&amp;L abierto</th><th><span className="sr-only">Detalle</span></th></tr></thead><tbody>{demoPositions.map(p => <tr key={p.symbol}><td><button className="demo-position-symbol" onClick={() => { setSymbol(p.symbol); inspect(p.symbol, p.structure + ' · ' + p.legs); }}>{p.symbol}</button><small>{p.legs}</small></td><td><button className="demo-strategy" onClick={() => inspect(p.strategy, p.structure + '. ' + p.note)}>{p.strategy}<ArrowUpRight size={12} /></button><small>{p.structure}</small></td><td>{p.quantity}</td><td className={p.dte <= 2 ? 'demo-warning' : ''}>{p.dte} días</td><td>{fmtPrice(p.value)}</td><td>{pnl(p.pnl)}</td><td><button className="demo-jump" aria-label={'Investigar posición demo ' + p.symbol} onClick={() => { setSymbol(p.symbol); inspect(p.strategy + ' · ' + p.symbol, p.note); }}><ArrowUpRight size={16} /></button></td></tr>)}</tbody></table></div>
        </section>
        <section className="demo-performance"><header><div className="demo-evolution-heading"><h2>Evolución de la cuenta</h2><strong>{pnl(values[values.length - 1] - values[0])}</strong><span>{period} sesiones</span></div><div className="demo-periods">{([5,20,60] as const).map(p => <button key={p} aria-pressed={period === p} onClick={() => setPeriod(p)}>{p === 5 ? '1S' : p === 20 ? '1M' : '3M'}</button>)}{jump('Performance', 'Evolución de patrimonio y resultados del período seleccionado.')}</div></header>
          <svg className="demo-equity" viewBox="0 0 740 116" preserveAspectRatio="none" role="img" aria-label="Curva de equity ficticia, no representa resultados reales"><defs><linearGradient id="demo-equity-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--accent)" stopOpacity=".16" /><stop offset="100%" stopColor="var(--accent)" stopOpacity="0" /></linearGradient></defs>{[30,65,100].map(y => <line key={y} x1="8" x2="732" y1={y} y2={y} stroke="var(--border-dark)" />)}<polygon points={'8,112 ' + line + ' 732,112'} fill="url(#demo-equity-fill)" /><polyline points={line} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg>
          <div className="demo-performance-footer"><span>Realizado hoy <strong>{pnl(demoAccount.realizedToday)}</strong></span><span>Acierto <strong>64%</strong> · 16 de 25 operaciones cerradas</span><span>USD</span></div>
        </section>
      </div>
      <aside className="demo-watchlist" aria-label="Watchlist"><header><h2>Watchlist</h2>{jump('Mercado', 'Precios y contexto del activo seleccionado.')}</header><table><thead><tr><th>Activo</th><th>Último</th><th>Cambio</th></tr></thead><tbody>{demoWatchlist.map(t => <tr key={t.symbol} className={symbol === t.symbol ? 'selected' : ''}><td><button onClick={() => { setSymbol(t.symbol); setDetail(null); }}>{t.symbol}</button></td><td>{fmtPrice(t.price)}</td><td className={t.change >= 0 ? 'demo-positive' : 'demo-negative'}>{t.change > 0 ? '+' : ''}{t.change.toFixed(2)}%</td></tr>)}</tbody></table>
        <section className="demo-symbol"><span>Activo seleccionado</span><div><strong>{active.symbol}</strong><span>{active.context}</span></div><p>{fmtPrice(active.price)} <span className={active.change >= 0 ? 'demo-positive' : 'demo-negative'}>{active.change > 0 ? '+' : ''}{active.change.toFixed(2)}%</span></p><button onClick={() => inspect(symbol + ' · Mercado', 'Precio, volatilidad y exposición GEX de ' + symbol + '.')} >Analizar {symbol}<ArrowUpRight size={14} /></button></section>
        {detail && <section className="demo-detail" aria-label="Detalle de demostración"><header><h3>{detail.title}</h3><button aria-label="Cerrar detalle demo" onClick={() => setDetail(null)}><X size={16} /></button></header><p>{detail.text}</p></section>}
      </aside>
    </div>
  </div>;
}
