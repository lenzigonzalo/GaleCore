/** Hora de las velas en la zona del reloj del monitor (Argentina). Diarias: fecha del día de la vela (UTC). */
export const CLOCK_TZ = 'America/Argentina/Buenos_Aires';

const HM = new Intl.DateTimeFormat('es-AR', { timeZone: CLOCK_TZ, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' });
const DM = new Intl.DateTimeFormat('es-AR', { timeZone: CLOCK_TZ, day: '2-digit', month: '2-digit' });
const DM_UTC = new Intl.DateTimeFormat('es-AR', { timeZone: 'UTC', day: '2-digit', month: '2-digit' });
const DMY_UTC = new Intl.DateTimeFormat('es-AR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' });

export function chartTimeSeconds(time: unknown): number | null {
  if (typeof time === 'number') return time;
  if (time && typeof time === 'object' && 'year' in (time as any)) {
    const t = time as { year: number; month: number; day: number };
    return Date.UTC(t.year, t.month - 1, t.day) / 1000;
  }
  return null;
}

/** Crosshair: «HH:mm» + fecha en intradía; sólo fecha en diarias. */
export function formatCrosshairTime(time: unknown, bucketSeconds: number): string {
  const s = chartTimeSeconds(time);
  if (s == null) return '';
  const d = new Date(s * 1000);
  return bucketSeconds >= 86400 ? DMY_UTC.format(d) : `${DM.format(d)} ${HM.format(d)}`;
}

/** Eje: hora en intradía (día en el primer tick del día); fecha en diarias. tickMarkType: 0 año, 1 mes, 2 día, 3 hora, 4 hora+seg. */
export function formatAxisTick(time: unknown, tickMarkType: number, bucketSeconds: number): string | null {
  const s = chartTimeSeconds(time);
  if (s == null) return null;
  const d = new Date(s * 1000);
  if (bucketSeconds >= 86400) return tickMarkType >= 3 ? null : DM_UTC.format(d);
  return tickMarkType <= 2 ? DM.format(d) : HM.format(d);
}
