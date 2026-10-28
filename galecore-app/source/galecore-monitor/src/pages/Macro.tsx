import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BoardRow, MacroBoard, fetchMacroBoard } from '../api/macroData';
import { MacroChart } from '../components/macro/MacroChart';
import './Macro.css';

/**
 * Macro como el panel de mercados de un bróker (WS-0036, ok del owner 15/10): seis números arriba y una tabla ordenada
 * por las preguntas que cuentan la historia del mercado, de lo general a lo específico (apetito por riesgo, tasas,
 * quién lidera, si lo confirman los demás); sin curva ni agenda al costado (la agenda ya está en el calendario). En «quién lidera», los
 * cocientes se leen como cuánto le ganó o perdió uno al otro.
 * Todo viene calculado de `GET /App/Macro/Board`; acá sólo se muestra.
 */

const REFRESH_MS = 60_000;

const num = (v: number, max: number) => v.toLocaleString('es-AR', { minimumFractionDigits: Math.min(2, max), maximumFractionDigits: max });

/** Último valor con los decimales que pide su magnitud (yen 0,006398; S&P 7.791). */
export function fmtLast(r: BoardRow): string {
  if (r.last == null) return '—';
  const a = Math.abs(r.last);
  const text = a >= 1000 ? num(r.last, 1).replace(/,0$/, '') : a >= 10 || r.unit === '%' || r.unit === 'pb' ? num(r.last, 2)
    : a >= 1 ? num(r.last, 4) : num(r.last, 6);
  return r.unit === '%' ? `${text} %` : r.unit === 'pb' ? `${text} pb` : text;
}

/** Cambio con signo en la unidad de la fila: % en precios, pb en tasas, puntos en volatilidad. */
export function fmtChange(v: number | null, unit: string): string {
  if (v == null) return '—';
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  const a = Math.abs(v);
  return unit === '%' ? `${sign}${num(a, 2)} %` : unit === 'pb' ? `${sign}${a.toFixed(0)} pb` : `${sign}${num(a, 2)}`;
}

/** Valor de mercado sumado: «+362 mil M» (miles de millones de USD). */
export function fmtUsdB(v: number): string {
  const b = v / 1e9;
  return `${b > 0 ? '+' : b < 0 ? '−' : ''}US$ ${Math.abs(b).toLocaleString('es-AR', { maximumFractionDigits: 0 })} mil M`;
}

const tone = (v: number | null | undefined) => v == null || v === 0 ? undefined : v > 0 ? 'pos' : 'neg';

function Spark({ row }: { row: BoardRow }) {
  const v = row.spark.map(p => p.value);
  if (v.length < 2) return <span />;
  const min = Math.min(...v), max = Math.max(...v), span = max - min || 1;
  const pts = v.map((y, i) => `${(i / (v.length - 1)) * 96 + 2},${26 - ((y - min) / span) * 22}`).join(' ');
  return <svg className="mb-spark" viewBox="0 0 100 30" aria-hidden="true">
    <polyline points={pts} fill="none" stroke={(row.changeMonth ?? 0) >= 0 ? 'var(--green)' : 'var(--red-gc)'} strokeWidth="1.6" />
  </svg>;
}

const SOURCES: Record<string, string> = { tastytrade: 'Tastytrade (contrato vigente)', treasury: 'Tesoro de EE. UU.', fred: 'FRED', cboe: 'Cboe' };
/** El código sólo aporta en futuros (/ESZ6: qué contrato es); en las series de FRED es ruido. */
const symbol = (r: BoardRow) => r.symbol.startsWith('/') ? <span className="mb-symbol">{r.symbol}</span> : null;

const dated = (r: BoardRow) => r.asOf ? `Dato del ${r.asOf.slice(8, 10)}/${r.asOf.slice(5, 7)}` : undefined;

export function Macro() {
  const [board, setBoard] = useState<MacroBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<BoardRow | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const dialog = useRef<HTMLElement>(null);

  const load = useCallback((signal?: AbortSignal) => fetchMacroBoard(signal)
    .then(b => { setBoard(b); setError(null); })
    .catch(e => { if (!signal?.aborted) setError(e?.response?.data?.error || 'No se pudo leer Macro.'); }), []);
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    const timer = setInterval(() => load(controller.signal), REFRESH_MS);
    return () => { controller.abort(); clearInterval(timer); };
  }, [load]);
  useEffect(() => { if (detail) dialog.current?.focus(); else opener.current?.focus(); }, [detail]);

  const open = (row: BoardRow, target: HTMLElement) => { opener.current = target; setDetail(row); };
  const [tab, setTab] = useState('resumen');
  const goTab = (id: string) => {
    setTab(id);
    window.scrollTo({ top: 0 });
  };
  const current = board?.tabs.find(t => t.id === tab) ?? board?.tabs[0];

  return <div className="macro-page">
    {error && !board && <p role="alert" className="macro-attention">{error} <button onClick={() => load()}>Reintentar</button></p>}
    {!board && !error && <p role="status">Leyendo mercados…</p>}
    {board && current && <>
      <nav className="macro-tabs" aria-label="Secciones Macro">{board.tabs.map(t =>
        <button key={t.id} aria-current={current.id === t.id ? 'page' : undefined} onClick={() => goTab(t.id)}>{t.name}</button>)}</nav>
      <div className="mb-strip">
        {board.strip.map(r => <button key={r.id} className="mb-stat" onClick={e => open(r, e.currentTarget)} title={dated(r)}>
          <span>{r.name}</span><strong>{fmtLast(r)}</strong><em className={tone(r.changeDay)}>{fmtChange(r.changeDay, r.changeUnit)}</em>
        </button>)}
      </div>
      <div className="mb-layout">
        <table className="mb-table">
          <thead><tr><th>Mercado</th><th>Último</th><th>Hoy</th><th>1 semana</th><th>1 mes</th><th aria-label="Último mes" /></tr></thead>
          {current.sections.flatMap(sec => sec.groups.map((g, i) => <tbody key={sec.question + g.name}>
            {i === 0 && <tr className="mb-question"><th colSpan={6}><div>{sec.question}
              {sec.detailTab && <button className="mb-more" onClick={() => goTab(sec.detailTab!)}>Ver detalle →</button>}</div></th></tr>}
            {g.name && <tr className="mb-group"><th colSpan={6}>{g.name}</th></tr>}
            {g.rows.map(r => <tr key={r.id} onClick={e => open(r, e.currentTarget as HTMLElement)} title={dated(r)}>
              <th><button onClick={e => { e.stopPropagation(); open(r, e.currentTarget); }}>{r.name}{symbol(r)}</button></th>
              <td>{r.valueAddedMonth != null ? <span className={tone(r.valueAddedMonth)}>{fmtUsdB(r.valueAddedMonth)}</span> : r.unit === 'rel' ? '' : fmtLast(r)}</td>
              <td className={tone(r.changeDay)}>{fmtChange(r.changeDay, r.changeUnit)}</td>
              <td className={tone(r.changeWeek)}>{fmtChange(r.changeWeek, r.changeUnit)}</td>
              <td className={tone(r.changeMonth)}>{fmtChange(r.changeMonth, r.changeUnit)}</td>
              <td><Spark row={r} /></td>
            </tr>)}
          </tbody>))}
        </table>
      </div>
      {board.missing.length > 0 && <p className="macro-attention">Sin datos: {board.missing.join(' · ')}</p>}
    </>}
    {detail && <div className="macro-detail-backdrop" onClick={() => setDetail(null)}>
      <section className="macro-detail" role="dialog" aria-modal="true" aria-label={detail.name} tabIndex={-1} ref={dialog}
        onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); setDetail(null); } }}>
        <button className="macro-close" onClick={() => setDetail(null)}>Cerrar · Esc</button>
        <h2>{detail.name} {symbol(detail)}</h2>
        <div className="macro-detail-values">
          {detail.unit !== 'rel' && <div><span>Último</span><strong>{fmtLast(detail)}</strong></div>}
          <div><span>Hoy</span><strong className={tone(detail.changeDay)}>{fmtChange(detail.changeDay, detail.changeUnit)}</strong></div>
          <div><span>1 semana</span><strong className={tone(detail.changeWeek)}>{fmtChange(detail.changeWeek, detail.changeUnit)}</strong></div>
          <div><span>1 mes</span><strong className={tone(detail.changeMonth)}>{fmtChange(detail.changeMonth, detail.changeUnit)}</strong></div>
        </div>
        <MacroChart points={detail.spark} unit={detail.unit === '%' ? '%' : ''} label={`${detail.name}, último mes`} />
        <p>{dated(detail)} · fuente: {SOURCES[detail.source] ?? detail.source}</p>
      </section>
    </div>}
  </div>;
}
