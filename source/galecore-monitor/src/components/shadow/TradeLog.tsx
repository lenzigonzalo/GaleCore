import React, { useState } from 'react';
import { PerformancePanelResponse } from '../../types/shadow';
import { fmtPrice } from '../../utils/formatters';
import { amount, date, days, exitLabel, pct, usd } from './panelPresentation';

type Trade = PerformancePanelResponse['closedTrades'][number];
const fields: (keyof Trade)[] = ['positionId', 'version', 'structure', 'legs', 'entryAt', 'exitAt', 'daysHeld', 'entryCredit', 'exitDebit', 'exitReason', 'realizedPnl', 'maxRisk', 'pnlPctOfCredit', 'pnlPctOfMaxRisk', 'gapToPlan', 'entryVix', 'entryIvRank', 'entryUnderlyingPrice', 'exitDte'];
export function tradeCsv(trades: Trade[]): string {
  const quote = (value: unknown) => value === null || value === undefined ? '' : `"${String(value).replace(/"/g, '""')}"`;
  return [fields.join(','), ...trades.map(trade => fields.map(field => quote(trade[field])).join(','))].join('\r\n');
}
const number = (value: number | null, format: (n: number) => string = fmtPrice) => value === null ? '—' : format(value);
export function TradeLog({ trades, spec }: { trades: Trade[]; spec: string }) {
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
  return <section className="performance-block"><div className="trade-log-heading"><h3>Operaciones cerradas</h3><div><button onClick={download}>Descargar CSV</button><button onClick={copy}>Copiar JSON</button></div></div>
    {message && <p role="status">{message}</p>}
    <div className="performance-table trade-log" tabIndex={0} role="region" aria-label="Log de operaciones"><table><thead><tr>{['Salida', 'Entrada', 'Días', 'Motivo', 'Versión', 'Estructura y strikes', 'Crédito', 'Débito', 'Resultado USD', '% del crédito', '% del riesgo', 'Desvío al plan', 'VIX al entrar', 'IV Rank al entrar', 'Subyacente al entrar', 'DTE al salir'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>
      {trades.map(trade => <tr key={trade.positionId}><td>{date(trade.exitAt)}</td><td>{date(trade.entryAt)}</td><td>{number(trade.daysHeld, days)}</td><td>{trade.exitReason ? exitLabel(trade.exitReason) : '—'}</td><td>{trade.version}</td><td><strong>{trade.structure}</strong><div>{trade.legs}</div></td><td>{amount(trade.entryCredit)}</td><td>{number(trade.exitDebit, amount)}</td><td>{number(trade.realizedPnl, usd)}</td><td>{number(trade.pnlPctOfCredit, pct)}</td><td>{number(trade.pnlPctOfMaxRisk, pct)}</td><td>{number(trade.gapToPlan, usd)}</td><td>{number(trade.entryVix)}</td><td>{number(trade.entryIvRank)}</td><td>{number(trade.entryUnderlyingPrice, amount)}</td><td>{number(trade.exitDte)}</td></tr>)}
      {!trades.length && <tr><td colSpan={16}>Sin salidas en el período</td></tr>}
    </tbody></table></div>
  </section>;
}
