import React, { useState } from 'react';
import type { ChatUsage } from '../../api/lab';

const number = new Intl.NumberFormat('es-AR');
const short = (n: number) => n >= 1000 ? number.format(Math.round(n / 100) / 10) + ' k' : number.format(n);
const percent = (v: number) => Math.round(v * 100) + ' %';
const WINDOWS: Record<string, string> = { five_hour: 'Límite de 5 horas', seven_day: 'Límite semanal' };
const hour = (secs?: number) => secs ? new Date(secs * 1000).toLocaleString('es-AR', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '';

/** Uso del chat (WS-0067): sólo lo que informa el motor; lo que no informa no se muestra. */
export function LabUsage({ usage }: { usage?: ChatUsage }) {
  const [open, setOpen] = useState(false);
  const turns = usage?.turns || [];
  const last = turns.at(-1);
  if (!usage || (!last && !usage.limit)) return null;
  const total = turns.reduce((s, t) => ({ input: s.input + t.input, output: s.output + t.output, cost: s.cost + (t.costUsd || 0) }), { input: 0, output: 0, cost: 0 });
  const context = usage.context && usage.context.window > 0 ? usage.context.used / usage.context.window : undefined;
  const hasCost = turns.some(t => typeof t.costUsd === 'number');
  const windows = Object.entries(usage.limit?.windows || {}).filter(([, w]) => typeof w.utilization === 'number');
  const summary = [last && short(last.input + last.output) + ' tokens', context !== undefined && 'contexto ' + percent(context)].filter(Boolean).join(' · ');
  return <div className="lab-usage">
    <button type="button" aria-expanded={open} aria-label="Uso del chat" onClick={() => setOpen(v => !v)}>{summary || 'Uso'}</button>
    {open && <dl role="group" aria-label="Detalle del uso">
      {last && <><dt>Último turno</dt><dd>{short(last.input)} entrada · {short(last.output)} salida{last.cached > 0 && ' · ' + short(last.cached) + ' de caché'}</dd></>}
      {turns.length > 1 && <><dt>Todo el chat</dt><dd>{short(total.input)} entrada · {short(total.output)} salida ({turns.length} turnos)</dd></>}
      {context !== undefined && <><dt>Contexto</dt><dd>{percent(context)} de {short(usage.context!.window)} tokens</dd></>}
      {windows.map(([key, w]) => <React.Fragment key={key}><dt>{WINDOWS[key] || key}</dt><dd>{percent(w.utilization!)} usado{w.resetsAt ? ' · se renueva ' + hour(w.resetsAt) : ''}</dd></React.Fragment>)}
      {hasCost && <><dt>Costo equivalente</dt><dd>US$ {total.cost.toFixed(2)} (con suscripción es una equivalencia, no un cobro)</dd></>}
    </dl>}
  </div>;
}
