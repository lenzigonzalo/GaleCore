import React, { useEffect, useState } from 'react';
import api from '../../api/client';
import type { MacroEvent } from '../../types/macroTypes';
import { MacroCalendar, eventName } from './MacroCalendar';

export function CalendarDock() {
  const [events, setEvents] = useState<MacroEvent[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<MacroEvent | null>(null);
  useEffect(() => {
    const controller = new AbortController(); let alive = true;
    const from = new Date(); const to = new Date(); to.setDate(to.getDate() + 45);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    Promise.allSettled([
      api.get('/Data/Fred/ReleaseDates', { params: { from: iso(from), to: iso(to), releaseIds: '10,50,46,53' }, signal: controller.signal }),
      api.get('/Data/Fed/FomcMeetings', { signal: controller.signal }),
    ]).then(results => {
      if (!alive) return;
      const rows: MacroEvent[] = []; const failed: string[] = [];
      results.forEach((result, index) => {
        const source = index === 0 ? 'FRED' : 'Fed';
        if (result.status === 'rejected') { failed.push(`${source}: no se pudo actualizar el calendario.`); return; }
        const response = result.value.data;
        (response.data || []).forEach((row: any) => {
          const date = index === 0 ? row.date : row.end;
          if (date < iso(from) || date > iso(to)) return;
          rows.push({ id: `${source}:${row.releaseId || 'meeting'}:${date}`, name: row.releaseName || 'Reunión FOMC', date,
            source, sourceRef: index === 0 ? 'https://fred.stlouisfed.org/releases/calendar' : response.upstreamUrl,
            retrievedAt: response.retrievedAt, timestampPrecision: 'day', limitations: ['Fecha programada; horario exacto no disponible.'] });
        });
      });
      setEvents(rows); setErrors(failed); setLoading(false);
    });
    return () => { alive = false; controller.abort(); };
  }, []);
  return <>{loading ? <p style={{ padding: 20 }}>Cargando calendario…</p> : <>
    <MacroCalendar events={events} onSelect={e => setSelected(e)} />
    {errors.map(e => <p key={e} role="status" className="macro-attention" style={{ padding: 12 }}>{e}</p>)}
    {selected && <section className="calendar-dock-detail"><h3>{eventName(selected.name)}</h3><p>{selected.date}</p><p>Fecha programada. El horario aún no está disponible.</p><a href={selected.sourceRef} target="_blank" rel="noreferrer">Ver publicación original ↗</a></section>}
  </>}</>;
}
