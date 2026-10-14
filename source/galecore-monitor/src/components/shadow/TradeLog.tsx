import React, { useState } from 'react';
import { Copy, Download } from 'lucide-react';
import { StrikeLadder } from '../monitor/StrikeLadder';
import { PerformanceGroup, PerformancePanelResponse } from '../../types/shadow';
import { fmtPrice, fmtTime, MARKET_TZ } from '../../utils/formatters';
import { amount, date, days, exitLabel, pct, usd } from './panelPresentation';

type Trade = PerformancePanelResponse['closedTrades'][number];
const fields: (keyof Trade)[] = ['positionId', 'symbol', 'legList', 'version', 'structure', 'legs', 'entryAt', 'exitAt', 'daysHeld', 'entryCredit', 'exitDebit', 'exitReason', 'realizedPnl', 'maxRisk', 'pnlPctOfCredit', 'pnlPctOfMaxRisk', 'gapToPlan', 'entryVix', 'entryIvRank', 'entryUnderlyingPrice', 'exitDte'];
export function tradeCsv(trades: Trade[]): string {
  const quote = (value: unknown) => value === null || value === undefined ? '' : `"${(typeof value === 'object' ? JSON.stringify(value) : String(value)).replace(/"/g, '""')}"`;
  return [fields.join(','), ...trades.map(trade => fields.map(field => quote(trade[field])).join(','))].join('\r\n');
}
const number = (value: number | null, format: (n: number) => string = fmtPrice) => value === null ? '—' : format(value);
export function TradeLog({ trades, spec, exits }: { trades: Trade[]; spec: string; exits: PerformanceGroup[] }) {
  const [message, setMessage] = useState('');
  const download = () => {
    const url = URL.createObjectURL(new Blob(['\uFEFF', tradeCsv(trades)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `${spec}-operaciones.csv`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(trades, null, 2)); setMessage('JSON copiado'); }
    catch { setMessage('No se pudo copiar. Permití el acceso al portapapeles y reintentá.'); }
  };
  const shortDate = (iso: string | null) => iso ? `${new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric', timeZone: MARKET_TZ })} ${fmtTime(new Date(iso)).slice(0, 5)}` : '—';
  const context = (trade: Trade) => [`Entrada: ${date(trade.entryAt)}`, `Salida: ${date(trade.exitAt)}`, `Versión: ${trade.version}`, `Estructura: ${trade.structure}`, `Patas: ${trade.legs}`, `Crédito: ${amount(trade.entryCredit)}`, `Débito: ${number(trade.exitDebit, amount)}`, `Subyacente al entrar: ${number(trade.entryUnderlyingPrice, amount)}`, `Riesgo: ${amount(trade.maxRisk)}`, `% del riesgo: ${number(trade.pnlPctOfMaxRisk, pct)}`].join('\n');
  return <section className="performance-block trade-log-block"><div className="trade-log-heading"><h3>Operaciones cerradas</h3><div><button className="trade-export" aria-label="Descargar CSV" title="Descargar CSV" onClick={download}><Download size={17} /></button><button className="trade-export" aria-label="Copiar JSON" title="Copiar JSON" onClick={copy}><Copy size={17} /></button></div></div>
    {!!exits.length && <div className="exit-summary" aria-label="Salidas por motivo">{exits.map(rule => <span key={rule.key} title={`${exitLabel(rule.key)} · ${number(rule.realizedPnl, usd)}`}>{exitLabel(rule.key)} <strong>{rule.trades}</strong></span>)}</div>}
    {message && <p role="status">{message}</p>}
    <div className="performance-table trade-log" tabIndex={0} role="region" aria-label="Log de operaciones"><table><thead><tr>{['Salida (ET)', 'Estructura / strikes', 'Días', 'Motivo', 'Resultado', '% crédito', 'Desvío al plan', 'VIX', 'IV Rank', 'DTE salida'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>
      {trades.map(trade => <tr key={trade.positionId} title={context(trade)}><td>{shortDate(trade.exitAt)}</td><td><div className="trade-structure"><strong title={trade.structure}>{trade.symbol}</strong><StrikeLadder compact legs={trade.legList} /></div></td><td className="numeric">{number(trade.daysHeld, days)}</td><td>{trade.exitReason ? exitLabel(trade.exitReason) : '—'}</td><td className="numeric" style={{ color: trade.realizedPnl === null || trade.realizedPnl === 0 ? undefined : trade.realizedPnl > 0 ? 'var(--green)' : 'var(--red-gc)' }}>{number(trade.realizedPnl, usd)}</td><td className="numeric">{number(trade.pnlPctOfCredit, pct)}</td><td className="numeric">{number(trade.gapToPlan, usd)}</td><td className="numeric">{number(trade.entryVix)}</td><td className="numeric">{number(trade.entryIvRank)}</td><td className="numeric">{number(trade.exitDte)}</td></tr>)}
      {!trades.length && <tr><td colSpan={10}>Sin salidas</td></tr>}
    </tbody></table></div>
  </section>;
}
