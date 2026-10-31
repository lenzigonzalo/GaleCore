import React from 'react';
import { PremarketQuote } from '../../api/marketdata';
import { fmtPct } from '../../utils/formatters';

const reasons: Record<string, string> = {
  missing_extended_hours: 'Sin operación premarket',
  not_premarket_trade: 'Último trade fuera de premarket',
  missing_previous_regular_close: 'Sin cierre de referencia',
  execution_revised: 'Operación corregida o cancelada; esperando un nuevo dato',
};

/** Sólo muestra la sesión identificada por GaleCore; nunca reutiliza el precio regular. */
export function PremarketCell({ quote, error }: { quote?: PremarketQuote; loading?: boolean; error?: boolean }) {
  const timestamp = quote?.timestamp ? new Date(quote.timestamp) : null;
  const validTime = timestamp && Number.isFinite(timestamp.getTime());
  const hasPrice = quote?.session === 'premarket' && validTime && quote.price != null && Number.isFinite(quote.price);
  const available = hasPrice && quote.changePercent != null && Number.isFinite(quote.changePercent);
  const stale = hasPrice && (error || quote.freshness !== 'fresh' || Date.now() - timestamp!.getTime() > 15 * 60_000);
  const color = !available ? 'var(--text-muted)'
    : quote!.changePercent! > 0 ? 'var(--green)' : quote!.changePercent! < 0 ? 'var(--red-gc)' : 'var(--text-secondary)';
  const detail = hasPrice ? `Premarket · ${quote!.source} · ${quote!.timestamp} · contra cierre regular anterior ${quote!.previousClose ?? 'no disponible'}${quote!.previousCloseDate ? ` (${quote!.previousCloseDate})` : ''}${stale ? ' · Dato viejo' : ''}${error ? ' · Falló la actualización' : ''}`
    : error ? 'No se pudo consultar premarket' : reasons[quote?.reason || ''] || 'Premarket no computado';
  return <td className="numeric tabular-nums watchlist-premarket" style={{ color }}
    title={detail} aria-label={detail}>
    {available ? quote!.changePercent === 0 ? '-' : fmtPct(quote!.changePercent!) : hasPrice ? '-' : ''}
  </td>;
}
