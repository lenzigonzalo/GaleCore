import React, { useEffect, useState } from 'react';
import type { ChatUsage } from '../../api/lab';

const percent = (v: number) => Math.round(v * 100) + ' %';
const WINDOWS: [string, string][] = [['five_hour', 'Sesión actual'], ['seven_day', 'Semanal']];
// La caché del prompt dura cerca de 1 h desde el último turno; pasado ese tiempo el próximo turno vuelve a pagar el contexto entero.
const CACHE_MINUTES = 60;
const span = (minutes: number) => minutes >= 60 ? Math.floor(minutes / 60) + ' h' + (minutes % 60 ? ' ' + (minutes % 60) + ' min' : '') : minutes + ' min';
/** Minutos que quedan de caché (0 = vencida); undefined si el último turno no usó caché. */
export function cacheLeft(last: { at: string; cached: number } | undefined, now = Date.now()): number | undefined {
  const at = last ? Date.parse(last.at) : NaN;
  if (!last || !(last.cached > 0) || !Number.isFinite(at)) return undefined;
  return Math.max(0, Math.ceil((at + CACHE_MINUTES * 60000 - now) / 60000));
}

/** Uso del chat: caché (cuánto falta o vencida), contexto y los dos límites del proveedor. Sólo lo que el motor informa. */
export function LabUsage({ usage }: { usage?: ChatUsage }) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const last = usage?.turns?.at(-1);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  if (!usage || (!last && !usage.limit)) return null;
  const context = usage.context && usage.context.window > 0 ? usage.context.used / usage.context.window : undefined;
  const windows = WINDOWS.filter(([key]) => typeof usage.limit?.windows?.[key]?.utilization === 'number');
  const cache = cacheLeft(last, now);
  const expired = cache === 0;
  const cacheText = cache === undefined ? '' : expired ? 'vencida' : 'vence en ' + span(cache);
  return <div className="lab-usage">
    <button type="button" className={expired ? 'expired' : undefined} aria-expanded={open} aria-label="Uso del chat" onClick={() => setOpen(v => !v)}>{cache === undefined ? 'Uso' : 'caché ' + cacheText}</button>
    {open && <dl role="group" aria-label="Detalle del uso">
      {cache !== undefined && <><dt>Caché</dt><dd className={expired ? 'expired' : undefined}>{cacheText}</dd></>}
      {context !== undefined && <><dt>Contexto</dt><dd>{percent(context)}</dd></>}
      {windows.map(([key, label]) => <React.Fragment key={key}><dt>{label}</dt><dd>{percent(usage.limit!.windows![key].utilization!)} usado</dd></React.Fragment>)}
    </dl>}
  </div>;
}
