import React, { useState } from 'react';
import { ArrowUpRight, ChevronRight, FlaskConical, X, Clock3 } from 'lucide-react';
import { demoAccount, demoWatchlist, demoPositions, demoAlerts, demoEquity } from './MainDemo.fixture';
import { fmtPnl, fmtPrice } from '../utils/formatters';
import './MainDemo.css';

/** TEMPORAL: prototipo de Main. Nunca alimenta stores, fuentes reales ni comandos. */
export function MainDemo({ onExit }: { onExit: () => void }) {
  const [symbol, setSymbol] = useState('SPY');
  const [period, setPeriod] = useState<5 | 20 | 60>(20);
  const [detail, setDetail] = useState<{ title: string; text: string } | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<number | null>(null);
  const values = demoEquity.slice(-period);
  const low = Math.min(...values) - 350, high = Math.max(...values) + 350;
  const points = values.map((value, i) => ({ x: 12 + i * 716 / (values.length - 1), y: 142 - (value - low) * 126 / (high - low), value }));
  const line = points.map(p => p.x + ',' + p.y).join(' ');
  const money = (value: number) => '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const inspect = (title: string, text: string) => setDetail({ title, text });
  const jump = (title: string, text: string) => <button className="demo-jump" aria-label={'Ver detalle demo de ' + title} onClick={() => inspect(title, text)}><ArrowUpRight size={17} /></button>;
  const pnl = (value: number) => <span className={value >= 0 ? 'demo-positive' : 'demo-negative'}>{fmtPnl(value)}</span>;
  return <div className="main-demo">
    <div className="demo-banner"><div><FlaskConical size={17} /><strong>DEMO VISUAL</strong><span>Todos los datos son ficticios · no es tu cuenta ni una ejecución SHADOW</span></div><button onClick={onExit}>Ver cuenta real<ArrowUpRight size={15} /></button></div>
    <div className="demo-intro"><div><span className="demo-eyebrow">GESTIÓN · ESCENARIO DE EJEMPLO</span><h2>Cuenta y mercado</h2></div><div className="demo-context"><span>Contexto demo</span><strong>{symbol}</strong><span>Escenario de ejemplo · 14:35 ET</span></div></div>
    <section className="demo-capital" aria-label="Capital ficticio">
      <button onClick={() => inspect('Cuenta demo', 'Capital y balances ficticios. En la pantalla final este acceso abrirá el resumen de Cartera.')}><span>Valor de la cuenta · USD</span><strong>{money(demoAccount.netLiq)}</strong><small>{pnl(demoAccount.dailyPnl)} <span>hoy · +0.66%</span></small></button>
      <button onClick={() => inspect('Efectivo demo', 'Efectivo ficticio del escenario, separado de poder de compra.')}><span>Efectivo</span><strong>{money(demoAccount.cash)}</strong><small>Disponible en el escenario</small></button>
      <button onClick={() => inspect('Poder de compra demo', 'Poder de compra ficticio; no equivale a efectivo ni a riesgo máximo.')}><span>Poder de compra</span><strong>{money(demoAccount.buyingPower)}</strong><small>Cuenta de ejemplo</small></button>
      <button onClick={() => inspect('Resultado abierto demo', 'Suma ficticia de las tres posiciones: +340 −185 +120 = +275 USD.')}><span>P&amp;L abierto</span><strong className="demo-positive">{fmtPnl(demoAccount.openPnl)}</strong><small>3 posiciones · valuación ficticia</small></button>
      {jump('Capital', 'El destino final es Cartera / Resumen y Riesgo. Este prototipo no abre ni modifica tu cuenta real.')}
    </section>
    <div className="demo-grid">
      <div className="demo-left">
        <section className="demo-widget demo-attention"><header><div><span className="demo-eyebrow">ATENCIÓN</span><h3>Claves del día <span className="demo-count">3</span></h3></div>{jump('Claves del día', 'Avisos ficticios para revisar jerarquía y continuidad con la investigación.')}</header>
          <div className="demo-widget-body">{demoAlerts.map((a, i) => <button key={a.label} className={'demo-alert ' + a.tone} onClick={() => { setSymbol(a.symbol); inspect(a.label + ' · demo', a.detail + ' En la versión final abrirá evidencia y conversación sobre el objeto real.'); }}><span className="demo-alert-order">0{i + 1}</span><div><strong>{a.label}</strong><p>{a.detail}</p><small>{a.symbol} · {a.time} · ficticio</small></div><ChevronRight size={15} /></button>)}</div>
          <footer><Clock3 size={13} /> Revisión de ejemplo · 14:32 ET</footer>
        </section>
        <section className="demo-widget demo-market"><header><div><span className="demo-eyebrow">SEGUIMIENTO</span><h3>Mercado &amp; watchlist</h3></div>{jump('Mercado', 'Destino previsto: Mercado con el símbolo seleccionado. Las cotizaciones de esta demo son ficticias.')}</header>
          <div className="demo-widget-body"><table><thead><tr><th>Activo</th><th>Último</th><th>Variación</th></tr></thead><tbody>{demoWatchlist.map(t => <tr key={t.symbol} className={symbol === t.symbol ? 'selected' : ''}><td><button onClick={() => { setSymbol(t.symbol); setDetail(null); }}>{t.symbol}<small>{t.context}</small></button></td><td>{fmtPrice(t.price)}</td><td className={t.change >= 0 ? 'demo-positive' : 'demo-negative'}>{t.change > 0 ? '+' : ''}{t.change.toFixed(2)}%</td></tr>)}</tbody></table></div>
          <footer><span>Precios y GEX ficticios</span><button onClick={() => inspect(symbol + ' · análisis demo', 'Contexto seleccionado sólo en la demo: ' + symbol + '. El recorrido final conservará el activo al abrir Mercado y la conversación.')} >Investigar {symbol}<ArrowUpRight size={14} /></button></footer>
        </section>
      </div>
      <div className="demo-right">
        <section className="demo-widget demo-performance"><header><div><span className="demo-eyebrow">EVOLUCIÓN · SERIE FICTICIA</span><h3>Performance</h3></div><div className="demo-widget-actions"><div className="demo-periods">{([5,20,60] as const).map(p => <button key={p} aria-pressed={period === p} onClick={() => { setPeriod(p); setSelectedPoint(null); }}>{p === 5 ? '1S' : p === 20 ? '1M' : '3M'}</button>)}</div>{jump('Performance', 'Serie ficticia de 5, 20 o 60 sesiones, según la ventana seleccionada. El gráfico real requiere historia y cálculos de cuenta.')}</div></header>
          <div className="demo-widget-body"><div className="demo-performance-top"><strong>{money(selectedPoint == null ? demoAccount.netLiq : points[selectedPoint].value)}</strong><span>{period} sesiones de ejemplo · USD</span></div>
            <svg className="demo-equity" viewBox="0 0 740 170" role="img" aria-label="Curva de equity ficticia, no representa resultados reales"><defs><linearGradient id="demo-equity-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--accent)" stopOpacity=".18" /><stop offset="100%" stopColor="var(--accent)" stopOpacity="0" /></linearGradient></defs>{[42,84,126].map(y => <line key={y} x1="12" x2="728" y1={y} y2={y} stroke="var(--border-dark)" />)}<polygon points={'12,156 ' + line + ' 728,156'} fill="url(#demo-equity-fill)" /><polyline points={line} fill="none" stroke="var(--accent)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />{points.map((p, i) => <g key={i}><circle cx={p.x} cy={p.y} r={selectedPoint === i ? 5 : 3} fill="var(--accent)" /><circle cx={p.x} cy={p.y} r="10" fill="transparent" onMouseEnter={() => setSelectedPoint(i)} onMouseLeave={() => setSelectedPoint(null)} /></g>)}</svg>
            <div className="demo-chart-axis"><span>Inicio del período ficticio</span><span>Última muestra ficticia</span></div>
            <div className="demo-performance-metrics"><div><span>P&amp;L realizado · día demo</span><strong>{pnl(demoAccount.realizedToday)}</strong></div><div><span>Tasa de acierto · muestra demo</span><strong>64.0% <small>16 / 25 cierres</small></strong></div><div><span>P&amp;L abierto · escenario</span><strong>{pnl(demoAccount.openPnl)}</strong></div></div>
          </div>
        </section>
        <section className="demo-widget demo-positions"><header><div><span className="demo-eyebrow">CARTERA · POSICIONES FICTICIAS</span><h3>Posiciones abiertas <span className="demo-count">3</span></h3></div>{jump('Posiciones', 'Destino previsto: Cartera / Posiciones. Estas estructuras son ejemplos visuales y no existen en tu cuenta.')}</header>
          <div className="demo-widget-body"><table><thead><tr><th>Instrumento / patas</th><th>Cant.</th><th>DTE</th><th>Valuación</th><th>P&amp;L abierto</th><th><span className="sr-only">Detalle</span></th></tr></thead><tbody>{demoPositions.map(p => <tr key={p.symbol}><td><button className="demo-position-symbol" onClick={() => { setSymbol(p.symbol); inspect(p.symbol + ' · posición demo', p.structure + '. ' + p.legs + '. ' + p.note); }}>{p.symbol}<span>{p.structure}</span></button><small>{p.legs}</small></td><td>{p.quantity}</td><td><span className={p.dte <= 2 ? 'demo-dte-warning' : ''}>{p.dte}d</span></td><td>{fmtPrice(p.value)}<small>por spread</small></td><td>{pnl(p.pnl)}</td><td><button className="demo-jump" aria-label={'Investigar posición demo ' + p.symbol} onClick={() => { setSymbol(p.symbol); inspect(p.symbol + ' · posición demo', p.note); }}><ArrowUpRight size={17} /></button></td></tr>)}</tbody></table></div>
          <footer><span>Ejemplos de posiciones de cuenta · no son LIVE ni SHADOW</span><strong>{pnl(demoAccount.openPnl)} <span>total abierto ficticio</span></strong></footer>
        </section>
      </div>
    </div>
    {detail && <aside className="demo-inspector" aria-label="Detalle de demostración"><header><span>DETALLE DEMO</span><button aria-label="Cerrar detalle demo" onClick={() => setDetail(null)}><X size={18} /></button></header><h3>{detail.title}</h3><p>{detail.text}</p><small>Interacción de prototipo. No consulta, modifica ni ejecuta sobre tu cuenta.</small></aside>}
  </div>;
}
