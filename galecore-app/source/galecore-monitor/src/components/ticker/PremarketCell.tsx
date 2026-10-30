import React from 'react';
import { PremarketQuote } from '../../api/marketdata';
import { fmtPct, fmtPrice, MARKET_TZ } from '../../utils/formatters';

const reasons: Record<string, string> = {
  missing_extended_hours: 'Sin operación premarket',
  not_premarket_trade: 'Último trade fuera de premarket',
  missing_previous_regular_close: 'Sin cierre de referencia',
};

/** Sólo muestra la sesión identificada por GaleCore; nunca reutiliza el precio regular. */
export function PremarketCell({ quote, loading, error }: { quote?: PremarketQuote; loading?: boolean; error?: boolean }) {
  const timestamp = quote?.timestamp ? new Date(quote.timestamp) : null;
  const validTime = timestamp && Number.isFinite(timestamp.getTime());
  const hasPrice = quote?.session === 'premarket' && validTime && quote.price != null && Number.isFinite(quote.price);
  const available = hasPrice && quote.changePercent != null && Number.isFinite(quote.changePercent);
  const stale = hasPrice && (error || quote.freshness !== 'fresh' || Date.now() - timestamp!.getTime() > 15 * 60_000);
  const color = !available ? 'var(--text-muted)' : stale ? 'var(--yellow-gc)'
    : quote!.changePercent! > 0 ? 'var(--green)' : quote!.changePercent! < 0 ? 'var(--red-gc)' : 'var(--text-secondary)';
  const time = validTime ? timestamp!.toLocaleString('es-AR', {
    timeZone: MARKET_TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }) : '';
  return <td className="numeric tabular-nums watchlist-premarket" style={{ color }}
    title={hasPrice ? `Premarket · ${quote!.source} · ${quote!.timestamp} · contra cierre regular anterior ${quote!.previousClose ?? 'no disponible'}${quote!.previousCloseDate ? ` (${quote!.previousCloseDate})` : ''}${error ? ' · Falló la actualización' : ''}`
      : error ? 'No se pudo consultar premarket' : reasons[quote?.reason || ''] || 'Sin dato premarket disponible'}>
    <span>{available ? fmtPct(quote!.changePercent!) : hasPrice ? fmtPrice(quote!.price!) : loading && !error ? 'Cargando…' : 'Sin dato'}</span>
    {hasPrice ? <>
      <time dateTime={quote!.timestamp!}>{time} ET</time>
      <small>DXLink{stale ? ' · Viejo' : ''}</small>
      {!available && <small>Sin cierre de referencia</small>}
    </> : !loading && <small>{error ? 'Falló la consulta' : reasons[quote?.reason || ''] || 'Premarket no disponible'}</small>}
  </td>;
}
