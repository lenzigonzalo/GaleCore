import React, { useState } from 'react';
import type { MacroEvent } from '../../types/macroTypes';
import './MacroCalendar.css';

const names: Record<string, string> = { 'Consumer Price Index': 'Inflación · CPI', 'Producer Price Index': 'Precios al productor · PPI', 'Gross Domestic Product': 'Actividad · PIB', 'Employment Situation': 'Empleo' };
export const eventName = (name: string) => names[name] || name;
const shortName = (name: string) => name.includes('Consumer') ? 'CPI' : name.includes('Producer') ? 'PPI' : name.includes('Domestic') ? 'PIB' : name.includes('Employment') ? 'Empleo' : name.includes('FOMC') ? 'FOMC' : name.endsWith(' · balance') ? name.split(' ')[0] : name;
export function MacroCalendar({ events, onSelect }: { events: MacroEvent[]; onSelect: (event: MacroEvent, target: HTMLElement) => void }) {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const first = (month.getDay() + 6) % 7;
  const total = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const prefix = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
  const days = Array.from({ length: Math.ceil((first + total) / 7) * 7 }, (_, index) => index - first + 1);
  const today = new Date();
  const move = (delta: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + delta, 1));
  return <section className="mc-calendar" aria-label="Calendario económico">
    <header><h2>{month.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}</h2><div>
      <button aria-label="Mes anterior" onClick={() => move(-1)}>‹</button>
      <button onClick={() => setMonth(new Date(today.getFullYear(), today.getMonth(), 1))}>Hoy</button>
      <button aria-label="Mes siguiente" onClick={() => move(1)}>›</button></div></header>
    <div className="mc-week">{['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(d => <span key={d}>{d}</span>)}</div>
    <div className="mc-days">{days.map((day, index) => {
      const valid = day > 0 && day <= total;
      const date = `${prefix}-${String(day).padStart(2, '0')}`;
      const matches = events.filter(e => e.date === date);
      const isToday = valid && day === today.getDate() && month.getMonth() === today.getMonth() && month.getFullYear() === today.getFullYear();
      return <div key={index} className={'mc-day' + (!valid ? ' empty' : '') + (isToday ? ' today' : '')}>
        {valid && <><span className="mc-date">{day}</span>{matches.map(e => <button key={e.id} aria-label={`${date} · ${eventName(e.name)}`} title={eventName(e.name)} onClick={click => onSelect(e, click.currentTarget)}><span className="mc-event-full">{eventName(e.name)}</span><span className="mc-event-short">{shortName(e.name)}</span></button>)}</>}
      </div>;
    })}</div>
    <p className="mc-coverage">Eventos disponibles desde hoy y durante los próximos 45 días. Las fechas pueden cambiar.</p>
  </section>;
}
