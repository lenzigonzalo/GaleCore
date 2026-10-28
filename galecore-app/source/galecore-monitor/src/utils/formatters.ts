import { PositionResponse, GroupedPosition } from '../types/api';

export function fmtPrice(n: number | null | undefined, decimals = 2): string {
  if (n == null) return '—';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function fmtCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

export function fmtPct(n: number, decimals = 2): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(decimals)}%`;
}

/** Fecha de expiración corta: "2026-07-17" → "17 Jul '26". */
export function fmtExpiry(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return dateStr;
  const day = d.getDate();
  const month = d.toLocaleString('en-US', { month: 'short' });
  const yy = String(d.getFullYear()).slice(2);
  return `${day} ${month} '${yy}`;
}

/** OI compacto: 12340 → "12.3k", 1500000 → "1.5M". */
export function fmtOI(n: number | null | undefined): string {
  if (n == null) return '—';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}

/**
 * GEX en la escala que le corresponde a su magnitud. Recibe SIEMPRE billones, que es la unidad en
 * la que lo devuelve la API (`metric: "billions_usd"`).
 *
 * BAJA A MILLONES por debajo de 1B, y esa mitad no es simetría estética: sin ella, todo símbolo
 * chico rendereaba `$0B`. Visto en SKM el 2026-08-18 — el GEX global, las dos filas de la Options
 * Chain y el Net GEX del Expiry Engine decían los cuatro `$0B`, mientras el mismo barrido reportaba
 * Call Wall 45, Put Wall 30 y un skew de 0.86 que solo puede salir de un callGEX real. El número no
 * era cero: era menos de medio billón redondeado a cero decimales. Y en la Options Chain eso anula
 * la razón de ser de la lista, que es comparar vencimientos entre sí.
 *
 * Lo que no llega ni al millón sale como `≈$0`, con el signo adentro del "casi": a esa magnitud el
 * signo no informa nada y `-<$1M` se lee peor que el problema que resuelve. Sigue sin decir `$0`,
 * que es lo que importa — el cero exacto es el único que se muestra como cero.
 */
export function fmtGex(billions: number): string {
  if (billions === 0) return '$0';
  if (Math.abs(billions) >= 1000) return `$${(billions / 1000).toFixed(1)}T`;
  if (Math.abs(billions) >= 1) return `$${billions.toFixed(0)}B`;

  const millions = billions * 1000;
  if (Math.abs(millions) < 1) return '≈$0';
  return `$${millions.toFixed(0)}M`;
}

/**
 * Zona del mercado. TODO lo que el tablero muestra como hora va en ET.
 *
 * Hasta 2026-08-10 `fmtTime` no pasaba `timeZone`, así que renderizaba en el huso del navegador
 * mientras la StatusBar le pegaba la etiqueta "ET" encima: desde Buenos Aires mostraba 10:45 y
 * decía ET cuando en ET eran las 09:45. Y como los timestamps de las cards salen del mismo helper,
 * quedaban coherentes entre sí pero desfasados una hora respecto de lo que el encabezado declaraba.
 */
export const MARKET_TZ = 'America/New_York';

export function fmtTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    timeZone: MARKET_TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/** Fecha de hoy EN ET como [año, mes 1-12, día]. Usar el día local o el UTC da el día equivocado
 *  cerca de la medianoche: desde Buenos Aires (UTC-3), a las 22:00 el día UTC ya avanzó pero en ET
 *  todavía es el día anterior. */
export function etDateParts(at: Date = new Date()): [number, number, number] {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat('en-US', {
    timeZone: MARKET_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(at)) p[x.type] = x.value;
  return [+p.year, +p.month, +p.day];
}

/**
 * Minutos que la hora de pared de ET adelanta sobre UTC en ese instante: -240 en EDT, -300 en EST.
 *
 * Sale de Intl a propósito, que aplica las reglas reales de DST (2º domingo de marzo, 1er domingo
 * de noviembre). La regla por mes que había antes — "marzo a noviembre = -4" — se equivoca la
 * primera semana de marzo y casi todo noviembre: ~5 semanas al año con una hora de error.
 */
export function etOffsetMinutes(at: Date): number {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat('en-US', {
    timeZone: MARKET_TZ, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at)) p[x.type] = x.value;

  const wallAsUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  // Se truncan los ms del instante: wallAsUtc no los tiene y sin truncar el cociente no da entero.
  return (wallAsUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000;
}

export function isStale(date: Date | null, thresholdMs = 60000): boolean {
  if (!date) return true;
  return Date.now() - date.getTime() > thresholdMs;
}

export function calcChange(price: number, open: number): { abs: number; pct: number } {
  if (!open) return { abs: 0, pct: 0 };
  const abs = price - open;
  const pct = (abs / open) * 100;
  return { abs, pct };
}

export function calcDte(expiration: string): number {
  const exp = new Date(expiration + 'T00:00:00');
  const now = new Date();
  const diff = exp.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

/**
 * Tinte translúcido válido para CUALQUIER color CSS, incluidas las `var(--x)`.
 * Concatenar alpha-hex a una var (`var(--green)1e`) produce un color inválido que el
 * navegador ignora (queda transparente); `color-mix` sí resuelve la var y aplica la opacidad.
 * @param color  color base (var(--x), #hex, rgb(), …)
 * @param pct    opacidad 0–100
 */
export function tint(color: string, pct: number): string {
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}

export function fmtPnl(n: number): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)}`;
}

export function groupPositions(positions: PositionResponse[]): GroupedPosition[] {
  const map = new Map<string, PositionResponse[]>();
  for (const p of positions) {
    const key = p.underlyingSymbol || p.symbol;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(p);
  }

  return Array.from(map.entries()).map(([sym, legs]) => {
    const unrealizedPnl = legs.reduce((sum, leg) => {
      const mult = leg.multiplier ?? 1;
      // Short: profit when price falls; Long: profit when price rises
      const sign = leg.quantityDirection === 'Short' ? -1 : 1;
      return sum + sign * (leg.closePrice - leg.averageOpenPrice) * leg.quantity * mult;
    }, 0);

    const realizedToday = legs.reduce((sum, leg) => {
      const sign = leg.realizedTodayEffect === 'Debit' ? -1 : 1;
      return sum + (leg.realizedToday ?? 0) * sign;
    }, 0);

    const hasOptions = legs.some(l => l.instrumentType !== 'Equity');
    const hasEquity  = legs.some(l => l.instrumentType === 'Equity');
    const typeLabel  = hasOptions && hasEquity ? 'Eq+Opt' : hasOptions ? 'Opt' : 'Eq';

    return { underlyingSymbol: sym, legs, legCount: legs.length, unrealizedPnl, realizedToday, typeLabel };
  });
}
