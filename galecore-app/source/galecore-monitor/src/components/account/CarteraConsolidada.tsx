import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { ConsolidatedPortfolio, PortfolioBroker, fetchConsolidatedPortfolio } from '../../api/portfolio';
import { fmtPrice } from '../../utils/formatters';
import './CarteraConsolidada.css';

const DASH = '—';
const ars = (n: number) => fmtPrice(n);   // mismo formato que el resto del monitor
const usd = (n?: number | null) => (n == null ? DASH : `$${fmtPrice(n)}`);
const tone = (n?: number | null) => (n == null || n === 0 ? '' : n > 0 ? 'pos' : 'neg');
const signed = (n?: number | null) => (n == null ? DASH : `${n > 0 ? '+' : n < 0 ? '-' : ''}$${fmtPrice(Math.abs(n))}`);
const pct = (n: number | null | undefined, total?: number | null) => (n == null || !total ? DASH : `${((n / total) * 100).toFixed(1)}%`);
const qty = (n?: number | null) => (n == null ? DASH : n.toLocaleString('en-US', { maximumFractionDigits: 4 }));
/** Precio en su moneda: USD sin prefijo, el resto con ella («ARS 1,234.50»). */
const money = (n: number | null | undefined, currency?: string | null) => {
  if (n == null) return DASH;
  return !currency || currency === 'USD' ? fmtPrice(n) : `${currency} ${ars(n)}`;
};
const closeDate = (iso?: string | null) => { const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}` : null; };
const FAILED = ['error', 'invalid', 'missing', 'partial'];

function BrokerCard({ broker, total }: { broker: PortfolioBroker; total?: number | null }) {
  const date = broker.isClose ? closeDate(broker.reportDate) : null;
  const failed = FAILED.includes(broker.status);
  const notes = broker.warnings.filter(w => !(broker.isClose && /cierre/i.test(w)));
  const lines = failed && broker.message ? [broker.message, ...notes.filter(w => w !== broker.message)] : notes;
  return <div className={'rs-panel ct-broker' + (failed ? ' failed' : '')}>
    <div className="ct-broker-head"><h2>{broker.name}</h2>{broker.isClose && <span className="ct-close">{date ? `Cierre del ${date}` : 'Cierre'}</span>}</div>
    <div className="ct-broker-total"><strong>{usd(broker.totalUsd)}</strong><span>{pct(broker.totalUsd, total)}</span></div>
    {lines.map((l, i) => <p key={i} className="ct-warn"><AlertTriangle size={14} />{l}</p>)}
  </div>;
}

/** Cartera de todos los brokers en dólares (WS-0108), como sección de Inicio. Se lee al abrir Inicio y con Actualizar. */
export function CarteraConsolidada() {
  const [data, setData] = useState<ConsolidatedPortfolio | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const load = useCallback(() => {
    setLoading(true); setError(false);
    return fetchConsolidatedPortfolio().then(d => { setData(d); }).catch(() => setError(true)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const names: Record<string, string> = Object.fromEntries((data?.brokers ?? []).map(b => [b.id, b.name]));
  const shown = (data?.brokers ?? []).filter(b => b.status !== 'excluded' && b.status !== 'soon');
  const total = data?.totalUsd;
  const positions = [...(data?.positions ?? [])].sort((a, b) => (b.marketValueUsd ?? -Infinity) - (a.marketValueUsd ?? -Infinity));
  const cash = (data?.cash ?? []).filter(c => c.amount !== 0);

  return <section className="ct" aria-label="Cartera de todos los brokers">
    <div className="ct-top">
      <h2>Todos los brokers</h2>
      <button className="ct-refresh" onClick={() => load()} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''} />Actualizar</button>
    </div>
    {error && <p className="rs-alert urgent"><AlertTriangle size={16} />No se pudo leer la cartera.</p>}
    {loading && <p className="rs-empty">Leyendo la cartera…</p>}
    {data && <>
      <div className="rs-strip">
        <div className="rs-stat rs-stat-main"><span>Valor de la cartera</span><strong>{usd(total)}</strong>
          {data.fx && <em>Pesos a dólares con el {data.fx.name} (venta) ${ars(data.fx.rate)}</em>}</div>
      </div>
      <div className="ct-brokers">{shown.map(b => <BrokerCard key={b.id} broker={b} total={total} />)}</div>

      <section className="rs-panel ct-section">
        <div className="rs-head"><h2>Posiciones</h2></div>
        {positions.length === 0 ? <p className="rs-empty">Sin posiciones abiertas.</p> :
          <div className="rs-table-scroll"><table className="rs-table">
            <thead><tr><th>Broker</th><th>Símbolo</th><th className="num">Cantidad</th><th className="num">Precio</th><th className="num">Valor (USD)</th><th className="num">Resultado</th><th className="num">% de la cartera</th></tr></thead>
            <tbody>{positions.map((p, i) => <tr key={`${p.broker}-${p.account}-${p.symbol}-${i}`}>
              <td>{names[p.broker] ?? p.broker}</td>
              <td><b>{p.symbol}</b>{p.description && <div className="ct-desc">{p.description}</div>}</td>
              <td className="num">{qty(p.quantity)}</td>
              <td className="num">{money(p.lastPrice, p.currency)}</td>
              <td className="num">{usd(p.marketValueUsd)}</td>
              <td className={'num ' + tone(p.pnlUsd)}>{signed(p.pnlUsd)}</td>
              <td className="num">{pct(p.marketValueUsd, total)}</td>
            </tr>)}</tbody>
          </table></div>}
      </section>

      {cash.length > 0 && <section className="rs-panel ct-section">
        <div className="rs-head"><h2>Efectivo</h2></div>
        <div className="rs-table-scroll"><table className="rs-table">
          <thead><tr><th>Broker</th><th>Cuenta</th><th>Moneda</th><th className="num">Monto</th><th className="num">En USD</th></tr></thead>
          <tbody>{cash.map((c, i) => <tr key={`${c.broker}-${c.account}-${c.currency}-${i}`}>
            <td>{names[c.broker] ?? c.broker}</td><td>{c.account ?? DASH}</td><td>{c.currency}</td>
            <td className="num">{c.amount == null ? DASH : c.currency === 'USD' ? fmtPrice(c.amount) : ars(c.amount)}</td>
            <td className="num">{c.amountUsd == null ? 'sin convertir' : usd(c.amountUsd)}</td>
          </tr>)}</tbody>
        </table></div>
      </section>}
    </>}
  </section>;
}
