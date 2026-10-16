import { useEffect, useRef, useState } from 'react';
import { labRequest } from '../../api/lab';
import './LabMapa.css';

// Mapa de la idea (WS-0039): lo escribe el agente en memory/mapa-<tema>.md y el Lab lo sirve por secciones.
// El panel sólo lee: sin botones ni edición; se relee al abrir la conversación y al terminar cada respuesta.
export interface MapaLine { mark: 'ok' | 'missing' | null; text: string }
export interface Mapa { path: string; updatedAt: string; title: string; sections: { heading: string; lines: MapaLine[] }[] }

const time = (iso: string) => new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

export function LabMapa({ chatId, running }: { chatId: string | null; running: boolean }) {
  const [mapa, setMapa] = useState<Mapa | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>(() => (chatId ? 'loading' : 'ready'));
  const shown = useRef<string | null>(null);
  useEffect(() => {
    // Otra conversación: no mostrar el mapa de la anterior mientras se lee el suyo.
    if (shown.current !== chatId) { shown.current = chatId; setMapa(null); setState(chatId ? 'loading' : 'ready'); }
    if (!chatId || running) return;
    let active = true;
    labRequest<{ mapa: Mapa | null }>('/chats/' + chatId + '/mapa')
      .then(v => { if (active) { setMapa(v.mapa); setState('ready'); } })
      .catch(() => { if (active) setState('error'); });
    return () => { active = false; };
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
            {s.lines.some(l => l.mark) || s.lines.length > 2
              ? <ul>{s.lines.map((l, i) => <li key={i} className={l.mark || ''}><span aria-hidden="true">{l.mark === 'ok' ? '✓' : l.mark === 'missing' ? '✗' : '·'}</span><span>{l.mark === 'missing' && <span className="sr-only">Falta: </span>}{l.text}</span></li>)}</ul>
              : s.lines.map((l, i) => <p key={i}>{l.text}</p>)}
          </section>)}
        </div>
      </>}
  </aside>;
}
