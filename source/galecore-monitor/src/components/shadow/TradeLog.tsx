import React, { useEffect, useState } from 'react';
import { Copy, Download, X } from 'lucide-react';
import { StrikeLadder } from '../monitor/StrikeLadder';
import { PerformanceGroup, PerformancePanelResponse, PanelGate } from '../../types/shadow';
import { fmtPrice, fmtTime, MARKET_TZ } from '../../utils/formatters';
import { amount, date, days, exitLabel, pct, usd } from './panelPresentation';

type Trade = PerformancePanelResponse['closedTrades'][number];
type Open = PerformancePanelResponse['openPositions'][number];
const fields: (keyof Trade)[] = ['positionId', 'symbol', 'legList', 'version', 'structure', 'legs', 'entryAt', 'exitAt', 'daysHeld', 'entryCredit', 'exitDebit', 'exitReason', 'realizedPnl', 'maxRisk', 'pnlPctOfCredit', 'pnlPctOfMaxRisk', 'gapToPlan', 'entryVix', 'entryIvRank', 'entryUnderlyingPrice', 'exitDte'];
export function tradeCsv(trades: Trade[]): string {
  const quote = (value: unknown) => value === null || value === undefined ? '' : `"${(typeof value === 'object' ? JSON.stringify(value) : String(value)).replace(/"/g, '""')}"`;
  return [fields.join(','), ...trades.map(trade => fields.map(field => quote(trade[field])).join(','))].join('\r\n');
}
const number = (value: number | null | undefined, format: (n: number) => string = fmtPrice) => value === null || value === undefined ? '—' : format(value);
const shortDate = (iso: string | null) => iso ? `${new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric', timeZone: MARKET_TZ })} ${fmtTime(new Date(iso)).slice(0, 5)}` : '—';
const tone = (n: number | null | undefined) => n === null || n === undefined || n === 0 ? undefined : n > 0 ? 'var(--green)' : 'var(--red-gc)';
const OPERATOR: Record<string, string> = { gt: '>', gte: '≥', ge: '≥', lt: '<', lte: '≤', le: '≤', eq: '=', between: 'entre', '>': '>', '>=': '≥', '<': '<', '<=': '≤' };

/** Una fila de la tabla: abierta o cerrada, con lo que el panel lateral necesita (WS-0057 C). */
interface Row {
  id: string; open: boolean; symbol: string; structure: string; version: string; legList: Trade['legList'];
  entryAt: string; exitAt: string | null; daysHeld: number | null; exitReason: string | null; entryCredit: number;
  exitDebit: number | null; currentValue: number | null; pnl: number | null; maxRisk: number; pnlPctOfCredit: number | null;
  pnlPctOfMaxRisk: number | null; gapToPlan: number | null; entryVix: number | null; entryIvRank: number | null;
  entryUnderlyingPrice: number | null; exitDte: number | null; currentDte: number | null; gates: PanelGate[];
}
const fromClosed = (t: Trade): Row => ({ id: t.positionId, open: false, symbol: t.symbol, structure: t.structure, version: t.version, legList: t.legList,
  entryAt: t.entryAt, exitAt: t.exitAt, daysHeld: t.daysHeld, exitReason: t.exitReason, entryCredit: t.entryCredit, exitDebit: t.exitDebit,
  currentValue: null, pnl: t.realizedPnl, maxRisk: t.maxRisk, pnlPctOfCredit: t.pnlPctOfCredit, pnlPctOfMaxRisk: t.pnlPctOfMaxRisk,
  gapToPlan: t.gapToPlan, entryVix: t.entryVix, entryIvRank: t.entryIvRank, entryUnderlyingPrice: t.entryUnderlyingPrice,
  exitDte: t.exitDte, currentDte: null, gates: t.entryGates ?? [] });
const fromOpen = (p: Open): Row => ({ id: p.positionId, open: true, symbol: p.symbol, structure: p.structure, version: p.version, legList: p.legList,
  entryAt: p.entryAt, exitAt: null, daysHeld: null, exitReason: null, entryCredit: p.entryCredit, exitDebit: null,
  currentValue: p.lastSpreadValue, pnl: p.unrealizedPnl, maxRisk: p.maxRisk,
  // Misma fórmula que el back para las cerradas (ShadowPerformance): en %, con un decimal.
  pnlPctOfCredit: p.unrealizedPnl === null || !p.entryCredit ? null : Math.round(p.unrealizedPnl / (p.entryCredit * 100) * 1000) / 10,
  pnlPctOfMaxRisk: p.unrealizedPnl === null || !p.maxRisk ? null : Math.round(p.unrealizedPnl / p.maxRisk * 1000) / 10,
  gapToPlan: null, entryVix: p.entryVix ?? null, entryIvRank: p.entryIvRank ?? null, entryUnderlyingPrice: p.entryUnderlyingPrice ?? null,
  exitDte: null, currentDte: p.currentDte, gates: p.entryGates ?? [] });

function Fact({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
  return <div className="op-fact"><span>{label}</span><strong style={color ? { color } : undefined}>{value}</strong></div>;
}

function OperationPanel({ row, onClose }: { row: Row; onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return <aside className="op-panel" role="dialog" aria-label={`Operación ${row.symbol}`}>
    <header><div><h3>{row.symbol} · {row.structure.replace(/_/g, ' ')}</h3><span className={'op-state' + (row.open ? ' is-open' : '')}>{row.open ? 'Abierta' : 'Cerrada'} · SHADOW · v{row.version}</span></div>
      <button aria-label="Cerrar" onClick={onClose}><X size={18} /></button></header>
    <div className="op-legs"><StrikeLadder legs={row.legList} /></div>
    <section><h4>Resultado (SHADOW)</h4><div className="op-facts">
      <Fact label={row.open ? 'P&L abierto' : 'P&L realizado'} value={number(row.pnl, usd)} color={tone(row.pnl)} />
      <Fact label="% del crédito" value={number(row.pnlPctOfCredit, pct)} color={tone(row.pnlPctOfCredit)} />
      <Fact label="% del riesgo" value={number(row.pnlPctOfMaxRisk, pct)} color={tone(row.pnlPctOfMaxRisk)} />
      {!row.open && <Fact label="Desvío al plan" value={number(row.gapToPlan, usd)} />}
    </div></section>
    <section><h4>Entrada</h4><div className="op-facts">
      <Fact label="Cuándo" value={date(row.entryAt)} />
      <Fact label="Crédito" value={amount(row.entryCredit)} />
      <Fact label="Riesgo máximo" value={amount(row.maxRisk)} />
      <Fact label="Subyacente" value={number(row.entryUnderlyingPrice, amount)} />
      <Fact label="VIX" value={number(row.entryVix)} />
      <Fact label="IV Rank" value={number(row.entryIvRank)} />
    </div>
      <table className="op-gates"><thead><tr><th>Regla de entrada</th><th>Valor</th><th>Condición</th><th /></tr></thead><tbody>
        {row.gates.map(g => <tr key={g.gateId}><td>{g.label || g.gateId}</td><td className="numeric">{number(g.value)}</td>
          <td className="numeric">{g.threshold === null || g.threshold === undefined ? '—' : `${OPERATOR[g.operator.toLowerCase()] ?? g.operator} ${fmtPrice(g.threshold)}`}</td>
          <td className={g.status === 'PASS' ? 'op-pass' : g.status === 'FAIL' ? 'op-fail' : undefined}>{g.status === 'PASS' ? '✓' : g.status === 'FAIL' ? '✗' : 'sin dato'}</td></tr>)}
        {!row.gates.length && <tr><td colSpan={4}>Esta operación es anterior al registro de reglas por entrada.</td></tr>}
      </tbody></table>
    </section>
    <section><h4>{row.open ? 'Ahora' : 'Salida'}</h4><div className="op-facts">
      {row.open ? <>
        <Fact label="Valor del spread" value={number(row.currentValue, amount)} />
        <Fact label="DTE" value={number(row.currentDte, n => String(Math.round(n)))} />
      </> : <>
        <Fact label="Cuándo" value={date(row.exitAt)} />
        <Fact label="Motivo" value={row.exitReason ? exitLabel(row.exitReason) : '—'} />
        <Fact label="Débito" value={number(row.exitDebit, amount)} />
        <Fact label="DTE al salir" value={number(row.exitDte, n => String(Math.round(n)))} />
        <Fact label="Días" value={number(row.daysHeld, days)} />
      </>}
    </div></section>
  </aside>;
}

export function TradeLog({ trades, spec, exits, open = [] }: { trades: Trade[]; spec: string; exits: PerformanceGroup[]; open?: Open[] }) {
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const rows = [...open.map(fromOpen), ...trades.map(fromClosed)];
  const current = rows.find(r => r.id === selected);
  const download = () => {
    const url = URL.createObjectURL(new Blob(['﻿', tradeCsv(trades)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `${spec}-operaciones.csv`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(trades, null, 2)); setMessage('JSON copiado'); }
    catch { setMessage('No se pudo copiar. Permití el acceso al portapapeles y reintentá.'); }
  };
  return <section className={'performance-block trade-log-block' + (current ? ' has-panel' : '')}>
    <div className="trade-log-heading"><h3>Operaciones</h3><div><button className="trade-export" aria-label="Descargar CSV" title="Descargar CSV" onClick={download}><Download size={17} /></button><button className="trade-export" aria-label="Copiar JSON" title="Copiar JSON" onClick={copy}><Copy size={17} /></button></div></div>
    {!!exits.length && <div className="exit-summary" aria-label="Salidas por motivo">{exits.map(rule => <span key={rule.key} title={`${exitLabel(rule.key)} · ${number(rule.realizedPnl, usd)}`}>{exitLabel(rule.key)} <strong>{rule.trades}</strong></span>)}</div>}
    {message && <p role="status">{message}</p>}
    <div className="op-layout">
      <div className="performance-table trade-log" tabIndex={0} role="region" aria-label="Log de operaciones"><table><thead><tr>{['Estado', 'Entrada (ET)', 'Salida (ET)', 'Estructura / strikes', 'Motivo', 'Resultado', '% riesgo'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>
        {rows.map(r => <tr key={r.id} className={'op-row' + (r.id === selected ? ' is-selected' : '')} onClick={() => setSelected(r.id === selected ? null : r.id)}
          tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') setSelected(r.id); }} aria-label={`Ver operación ${r.symbol} ${shortDate(r.entryAt)}`}>
          <td><span className={'op-state' + (r.open ? ' is-open' : '')}>{r.open ? 'Abierta' : 'Cerrada'}</span></td>
          <td>{shortDate(r.entryAt)}</td><td>{shortDate(r.exitAt)}</td>
          <td><div className="trade-structure"><strong title={r.structure}>{r.symbol}</strong><StrikeLadder compact legs={r.legList} /></div></td>
          <td>{r.exitReason ? exitLabel(r.exitReason) : r.open ? 'en curso' : '—'}</td>
          <td className="numeric" style={{ color: tone(r.pnl) }}>{number(r.pnl, usd)}</td>
          <td className="numeric" style={{ color: tone(r.pnlPctOfMaxRisk) }}>{number(r.pnlPctOfMaxRisk, pct)}</td>
        </tr>)}
        {!rows.length && <tr><td colSpan={7}>Sin operaciones</td></tr>}
      </tbody></table></div>
      {current && <OperationPanel row={current} onClose={() => setSelected(null)} />}
    </div>
  </section>;
}
