import { TickerState } from '../types/market';
import { fmtTime, MARKET_TZ } from './formatters';

/** Horario regular ET; dentro del horario sólo se confirma apertura con señal reciente del proveedor. */
export function regularSessionLabel(now:Date, ticker:TickerState|undefined, connected:boolean):string {
  const day=now.toLocaleDateString('en-US',{timeZone:MARKET_TZ,weekday:'short'});
  const time=fmtTime(now).split(':').map(Number);
  const minutes=time[0]*60+time[1];
  if (day === 'Sat' || day === 'Sun' || minutes < 570 || minutes >= 960) return 'Rueda regular cerrada';
  const statusTime=ticker?.marketStatusReceivedAt;
  const sourceTime=ticker?.marketStatusSourceAt;
  if (!connected || !statusTime || !sourceTime || !Number.isFinite(sourceTime.getTime()) || sourceTime.getTime() > now.getTime() || now.getTime()-sourceTime.getTime() > 60000 || now.getTime()-statusTime.getTime() > 60000) return 'Apertura sin confirmar';
  return ticker?.extendedTradingHours === false ? 'Rueda regular abierta' : ticker?.extendedTradingHours === true ? 'Fuera de rueda regular' : 'Apertura sin confirmar';
}

export interface SessionCountdown { open: boolean; opensAt: Date; closesAt: Date; remainingMs: number; }

const ET_PARTS = new Intl.DateTimeFormat('en-US', { timeZone: MARKET_TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });

function etParts(d: Date) {
  const o: Record<string, string> = {};
  for (const p of ET_PARTS.formatToParts(d)) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour, mi: +o.minute, s: +o.second, wd: o.weekday };
}

/** Instante UTC de una hora de pared ET (hh:mm) en el día ET dado. */
function etWallToDate(y: number, m: number, d: number, hh: number, mm: number): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const p = etParts(new Date(guess));
  const asIfUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi);
  return new Date(guess - (asIfUtc - guess));
}

const isWeekday = (wd: string) => wd !== 'Sat' && wd !== 'Sun';

/**
 * Sesión regular 09:30–16:00 ET en días hábiles (sin calendario de feriados ni medias ruedas: no está modelado).
 * Devuelve la próxima apertura y el próximo cierre, y cuánto falta para lo que corresponde.
 */
export function regularSessionCountdown(now: Date): SessionCountdown {
  const p = etParts(now);
  const minutes = p.h * 60 + p.mi;
  const open = isWeekday(p.wd) && minutes >= 570 && minutes < 960;
  let day = new Date(Date.UTC(p.y, p.m - 1, p.d));
  // Día de la sesión de referencia: hoy si está abierto o falta abrir; si no, el próximo día hábil.
  if (!open && !(isWeekday(p.wd) && minutes < 570)) day = new Date(day.getTime() + 86400000);
  while (day.getUTCDay() === 0 || day.getUTCDay() === 6) day = new Date(day.getTime() + 86400000);
  const y = day.getUTCFullYear(), m = day.getUTCMonth() + 1, d = day.getUTCDate();
  const opensAt = etWallToDate(y, m, d, 9, 30);
  const closesAt = etWallToDate(y, m, d, 16, 0);
  return { open, opensAt, closesAt, remainingMs: (open ? closesAt : opensAt).getTime() - now.getTime() };
}

/** «2h 15m» (o «14h 03m»; con días «2d 3h» si pasan de 24 h). */
export function fmtRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 60000));
  const d = Math.floor(total / 1440), h = Math.floor((total % 1440) / 60), m = total % 60;
  if (d > 0) return `${d}d ${h}h`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}
