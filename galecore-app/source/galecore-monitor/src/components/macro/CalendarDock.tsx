import React, { useEffect, useState } from 'react';
import api from '../../api/client';
import type { MacroEvent } from '../../types/macroTypes';
import { MacroCalendar, eventName } from './MacroCalendar';

const TIME_OF_DAY: Record<string, string> = { BMO: 'antes de la apertura', AMC: 'después del cierre' };

/** Agenda macro (FRED, Fed) y balances de las empresas de la watchlist (Tastytrade, vía GaleCore). */
export function CalendarDock({ symbols = [] }: { symbols?: string[] }) {
  const [events, setEvents] = useState<MacroEvent[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<MacroEvent | null>(null);
  const symbolsKey = symbols.join(',');
  useEffect(() => {
    const controller = new AbortController(); let alive = true;
    const from = new Date(); const to = new Date(); to.setDate(to.getDate() + 45);
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    Promise.allSettled([
      api.get('/Data/Fred/ReleaseDates', { params: { from: iso(from), to: iso(to), releaseIds: '10,50,46,53' }, signal: controller.signal }),
      api.get('/Data/Fed/FomcMeetings', { signal: controller.signal }),
      symbolsKey ? api.get('/Data/Tastytrade/Market-metrics/VolatilityData', { params: { symbols: symbolsKey }, signal: controller.signal }) : Promise.resolve(null),
    ]).then(results => {
      if (!alive) return;
      const rows: MacroEvent[] = []; const failed: string[] = [];
      results.forEach((result, index) => {
        const source = ['FRED', 'Fed', 'Tastytrade'][index];
        if (result.status === 'rejected') { failed.push(`${source}: no se pudo actualizar ${index === 2 ? 'los balances' : 'el calendario'}.`); return; }
        if (!result.value) return;
        const response = result.value.data;
        if (index === 2) {
          (response.items || []).forEach((item: any) => {
            const e = item.earnings; const date = e?.expectedReportDate;
            if (!date || date < iso(from) || date > iso(to)) return;
            rows.push({ id: `Tastytrade:earnings:${item.symbol}:${date}`, name: `${item.symbol} · balance`, date, source, sourceRef: '',
              retrievedAt: new Date().toISOString(), timestampPrecision: 'day', limitations: [],
              earnings: { symbol: item.symbol, timeOfDay: e.timeOfDay ?? null, estimated: e.estimated ?? null, consensusEps: e.consensusEps ?? null } });
          });
          return;
        }
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
  }, [symbolsKey]);
  return <>{loading ? <p style={{ padding: 20 }}>Cargando calendario…</p> : <>
    <p className="calendar-dock-scope">Agenda actual</p><MacroCalendar events={events} onSelect={e => setSelected(e)} />
    {errors.map(e => <p key={e} role="status" className="macro-attention" style={{ padding: 12 }}>{e}</p>)}
    {selected && <section className="calendar-dock-detail"><h3>{eventName(selected.name)}</h3><p>{selected.date}</p>{selected.earnings
      ? <p>{selected.earnings.estimated ? 'Fecha estimada' : 'Fecha confirmada'}{selected.earnings.timeOfDay ? ` · ${TIME_OF_DAY[selected.earnings.timeOfDay] ?? selected.earnings.timeOfDay}` : ' · horario no informado'}{selected.earnings.consensusEps != null ? ` · EPS esperado ${selected.earnings.consensusEps}` : ''}</p>
      : <><p>Fecha programada. El horario aún no está disponible.</p><a href={selected.sourceRef} target="_blank" rel="noreferrer">Ver publicación original ↗</a></>}<details><summary>Fuente y actualización</summary><p>{selected.source} · consultado {new Date(selected.retrievedAt).toLocaleString('es-AR')}</p></details></section>}
  </>}</>;
}
