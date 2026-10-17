import { useEffect, useRef, useState } from 'react';
import { labRequest } from '../../api/lab';
import './LabMapa.css';

// Mapa de la idea (WS-0039): lo escribe el agente en memory/mapa-<tema>.md y el Lab lo sirve por secciones.
// El panel sólo lee: sin botones ni edición; se relee al abrir la conversación y al terminar cada respuesta.
export interface MapaLine { mark: 'ok' | 'missing' | 'now' | null; text: string }
export interface MapaSection { heading: string; lines: MapaLine[]; table?: { header: string[]; rows: string[][] } }
export interface Mapa { path: string; updatedAt: string; title: string; sections: MapaSection[] }

// WS-0044: «Camino» es por dónde va la idea (✓ hecho, → acá, resto por hacer); las tablas (hipótesis H1, H2…) se
// muestran como tabla y cada fila se puede señalar desde el chat por su primera celda (#mapa-h1).
const rowId = (cell: string) => 'mapa-' + cell.toLowerCase().replace(/[^a-z0-9]+/g, '');

function Camino({ lines }: { lines: MapaLine[] }) {
  return <ol className="lab-mapa-camino">{lines.map((l, i) => {
    const [step, ...rest] = l.text.split(':');
    return <li key={i} className={l.mark || 'todo'} aria-current={l.mark === 'now' ? 'step' : undefined}>
      <span aria-hidden="true">{l.mark === 'ok' ? '✓' : i + 1}</span><b>{step.trim()}</b>{rest.length > 0 && <em>{rest.join(':').trim()}</em>}
    </li>;
  })}</ol>;
}

function Tabla({ table }: { table: NonNullable<MapaSection['table']> }) {
  return <table className="lab-mapa-table"><thead><tr>{table.header.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
    <tbody>{table.rows.map((r, i) => <tr key={i} id={rowId(r[0] || '')}>{r.map((c, j) => j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>)}</tr>)}</tbody></table>;
}

const time = (iso: string) => new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });

export function LabMapa({ chatId, running }: { chatId: string | null; running: boolean }) {
  const [mapa, setMapa] = useState<Mapa | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>(() => (chatId ? 'loading' : 'ready'));
  const shown = useRef<string | null>(null);
  useEffect(() => {
    // Otra conversación: no mostrar el mapa de la anterior mientras se lee el suyo.
    if (shown.current !== chatId) { shown.current = chatId; setMapa(null); setState(chatId ? 'loading' : 'ready'); }
    if (!chatId) return;
    let active = true;
    const read = () => labRequest<{ mapa: Mapa | null }>('/chats/' + chatId + '/mapa')
      .then(v => { if (active) { setMapa(m => v.mapa || m); setState('ready'); } })
      .catch(() => { if (active) setState('error'); });
    read();
    // Mientras responde, el mapa aparece apenas el agente lo escribe; al terminar se relee una vez más.
    const timer = running ? window.setInterval(read, 4000) : undefined;
    return () => { active = false; if (timer) window.clearInterval(timer); };
  }, [chatId, running]);

  return <aside className="lab-mapa" aria-label="Mapa de la idea">
    {state === 'error' && !mapa ? <p className="lab-mapa-empty" role="alert">No se pudo leer el mapa. Se vuelve a intentar al terminar la próxima respuesta.</p>
      : state === 'loading' && !mapa ? <p className="lab-mapa-empty" role="status">Leyendo el mapa…</p>
      : !mapa ? <p className="lab-mapa-empty">El mapa aparece cuando la conversación arma una idea.</p>
      : <>
        <header><h2>{mapa.title || 'Idea'}</h2><span>{running ? 'Actualizando…' : 'Actualizado ' + time(mapa.updatedAt)}{state === 'error' ? ' · no se pudo releer' : ''}</span></header>
        <div className="lab-mapa-cells">
          {mapa.sections.map(s => <section key={s.heading} className={'lab-mapa-cell' + (/falta decidir/i.test(s.heading) ? ' open' : '')}>
            <h3>{s.heading}</h3>
            {s.table && <Tabla table={s.table} />}
            {/^camino/i.test(s.heading) ? <Camino lines={s.lines} />
              : s.lines.some(l => l.mark) || s.lines.length > 2
              ? <ul>{s.lines.map((l, i) => <li key={i} className={l.mark || ''}><span aria-hidden="true">{l.mark === 'ok' ? '✓' : l.mark === 'missing' ? '✗' : '·'}</span><span>{l.mark === 'missing' && <span className="sr-only">Falta: </span>}{l.text}</span></li>)}</ul>
              : s.lines.map((l, i) => <p key={i}>{l.text}</p>)}
          </section>)}
        </div>
      </>}
  </aside>;
}
