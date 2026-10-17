import { useEffect, useRef, useState } from 'react';
import type { IChartApi, Time } from 'lightweight-charts';
import { labRequest } from '../../api/lab';
import './LabMapa.css';

// Mapa de la idea (WS-0039): lo escribe el agente en memory/mapa-<tema>.md y el Lab lo sirve por secciones.
// El panel sólo lee: sin botones ni edición; se relee al abrir la conversación y al terminar cada respuesta.
// WS-0044 (owner: tablero): arriba dónde estamos y qué falta, las cifras grandes y el gráfico de la evidencia con su fuente.
export interface MapaLine { mark: 'ok' | 'missing' | null; text: string }
export interface MapaChart { fuente?: string; unidad?: string; corte?: string; calculo?: string; series: { nombre: string; puntos: [string, number][] }[] }
export interface MapaSection { heading: string; lines: MapaLine[]; chart?: MapaChart }
export interface Mapa { path: string; updatedAt: string; title: string; intro?: string[]; sections: MapaSection[] }

const time = (iso: string) => new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
const day = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : d;
const COLORS = ['--accent', '--yellow-gc', '--green', '--red'];

function MapaChartView({ chart, label }: { chart: MapaChart; label: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current || !chart.series.some(s => s.puntos?.length)) return;
    let api: IChartApi | undefined, alive = true;
    void import('lightweight-charts').then(({ createChart, LineSeries, ColorType }) => {
      if (!alive || !host.current) return;
      const css = getComputedStyle(host.current), v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
      api = createChart(host.current, { autoSize: true, height: 200,
        layout: { background: { type: ColorType.Solid, color: v('--bg-secondary', '#141414') }, textColor: v('--text-secondary', '#b5b5b5'), fontSize: 12 },
        grid: { vertLines: { visible: false }, horzLines: { color: '#262626' } },
        timeScale: { borderVisible: false }, rightPriceScale: { borderVisible: false }, handleScroll: false, handleScale: false });
      chart.series.forEach((s, i) => {
        const line = api!.addSeries(LineSeries, { color: v(COLORS[i % COLORS.length], '#c7d2cb'), lineWidth: 2, priceLineVisible: false, lastValueVisible: false,
          priceFormat: { type: 'custom', formatter: (x: number) => x.toLocaleString('es-AR', { maximumFractionDigits: 1 }) + (chart.unidad ? ' ' + chart.unidad : '') } });
        line.setData((s.puntos || []).filter(p => Number.isFinite(p[1])).map(([t, value]) => ({ time: t as Time, value })));
      });
      api.timeScale().fitContent();
    });
    return () => { alive = false; api?.remove(); };
  }, [chart]);
  return <figure className="lab-mapa-chart">
    <div ref={host} role="img" aria-label={label} />
    <figcaption>
      {chart.series.map((s, i) => <span key={s.nombre} className="lab-mapa-legend" style={{ color: `var(${COLORS[i % COLORS.length]})` }}>— {s.nombre}</span>)}
      {chart.fuente && <span className="lab-mapa-source">Fuente: {chart.fuente}{chart.corte ? ' · hasta el ' + day(chart.corte) : ''}</span>}
      {chart.calculo && <span className="lab-mapa-source">Cálculo guardado en Archivos: {chart.calculo.split('/').pop()}</span>}
    </figcaption>
  </figure>;
}

function Numeros({ lines }: { lines: MapaLine[] }) {
  return <div className="lab-mapa-numbers">{lines.map((l, i) => {
    const [value, ...what] = l.text.split('·');
    return <div key={i}><strong>{value.trim()}</strong>{what.length > 0 && <span>{what.join('·').trim()}</span>}</div>;
  })}</div>;
}

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
        {mapa.intro && mapa.intro.length > 0 && <div className="lab-mapa-intro">{mapa.intro.map((l, i) => {
          const [k, ...rest] = l.split(':');
          return rest.length ? <p key={i}><b>{k.trim()}:</b> {rest.join(':').trim()}</p> : <p key={i}>{l}</p>;
        })}</div>}
        <div className="lab-mapa-cells">
          {mapa.sections.map(s => <section key={s.heading} className={'lab-mapa-cell' + (/falta decidir|próxima decisión/i.test(s.heading) ? ' open' : '')}>
            <h3>{s.heading}</h3>
            {s.chart && <MapaChartView chart={s.chart} label={s.heading} />}
            {/^números/i.test(s.heading) ? <Numeros lines={s.lines} />
              : s.lines.some(l => l.mark) || s.lines.length > 2
              ? <ul>{s.lines.map((l, i) => <li key={i} className={l.mark || ''}><span aria-hidden="true">{l.mark === 'ok' ? '✓' : l.mark === 'missing' ? '✗' : '·'}</span><span>{l.mark === 'missing' && <span className="sr-only">Falta: </span>}{l.text}</span></li>)}</ul>
              : s.lines.map((l, i) => <p key={i}>{l.text}</p>)}
          </section>)}
        </div>
      </>}
  </aside>;
}
