import React, { useEffect, useState } from 'react';
import { PerformancePanelResponse } from '../../types/shadow';
import { MARKET_TZ } from '../../utils/formatters';
import { usd } from './panelPresentation';

export function PnlCalendar({ daily, asOf }: { daily: PerformancePanelResponse['daily']; asOf: string }) {
  const latest = daily[daily.length - 1]?.date || new Intl.DateTimeFormat('sv-SE', { timeZone: MARKET_TZ }).format(new Date(asOf));
  const [month, setMonth] = useState(latest.slice(0, 7));
  useEffect(() => { setMonth(latest.slice(0, 7)); }, [latest]);
  const [year, number] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year, number - 1, 1));
  const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const offset = (first.getUTCDay() + 6) % 7;
  const entries = new Map(daily.map(day => [day.date, day]));
  // Visual intensity only; the daily P&L and trade count are supplied by the API.
  const scale = Math.max(1, ...daily.filter(day => day.date.startsWith(month)).map(day => Math.abs(day.pnl)));
  const move = (delta: number) => setMonth(new Date(Date.UTC(year, number - 1 + delta, 1)).toISOString().slice(0, 7));
  return <div className="pnl-calendar">
    <div className="calendar-heading"><button aria-label="Mes anterior" onClick={() => move(-1)}>←</button><strong>{first.toLocaleDateString('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</strong><button aria-label="Mes siguiente" onClick={() => move(1)}>→</button></div>
    <div className="calendar-grid">{['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(day => <div className="calendar-weekday" key={day}>{day}</div>)}
      {Array.from({ length: offset }, (_, index) => <div key={`empty-${index}`} />)}
      {Array.from({ length: count }, (_, index) => {
        const day = index + 1;
        const key = `${month}-${String(day).padStart(2, '0')}`;
        const entry = entries.get(key);
        const color = entry && entry.pnl < 0 ? 'var(--red-gc)' : 'var(--green)';
        return <div key={key} className="calendar-day" title={entry ? `${key} · ${entry.trades} cierre(s)` : key}
          style={entry ? { background: `color-mix(in srgb, ${color} ${12 + Math.abs(entry.pnl) / scale * 35}%, var(--bg-secondary))`, borderColor: color } : undefined}>
          <span>{day}</span>{entry && <strong className="font-mono" style={{ color }}>{usd(entry.pnl)}</strong>}
        </div>;
      })}
    </div>
  </div>;
}
