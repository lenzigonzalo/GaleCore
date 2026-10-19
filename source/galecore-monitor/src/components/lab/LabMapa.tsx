import { useEffect, useRef, useState } from 'react';
import type { IChartApi, Time } from 'lightweight-charts';
import { ArrowUpRight } from 'lucide-react';
import { labRequest } from '../../api/lab';
import './LabMapa.css';
import '../shadow/PerformancePanel.css';

// Mapa de la idea (WS-0039): lo escribe el agente en memory/mapa-<tema>.md y el Lab lo sirve por secciones.
// El panel sólo lee; se relee al abrir la conversación y al terminar cada respuesta.
export interface MapaLine { mark: 'ok' | 'missing' | null; text: string }
export interface MapaChart { fuente?: string; unidad?: string; corte?: string; calculo?: string; series: { nombre: string; puntos: [string, number][] }[] }
export interface MapaSection { heading: string; lines: MapaLine[]; chart?: MapaChart; table?: { head: string[]; rows: string[][] } }
export interface Mapa { path: string; updatedAt: string; title: string; intro?: string[]; sections: MapaSection[] }

const time = (iso: string) => new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
const day = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : d;
const COLORS = ['--accent', '--yellow-gc', '--green', '--red'];

const isDate = (x: string) => /^\d{4}-\d{2}-\d{2}$/.test(x);

// WS-0045: una serie cuyo eje no son fechas (p. ej. GEX por strike) va en barras: el gráfico de tiempo no la entiende.
function CategoryBars({ chart, label }: { chart: MapaChart; label: string }) {
  const pts = chart.series[0]?.puntos?.filter(p => Number.isFinite(p[1])) || [];
  const W = 640, H = 200, pad = 28, max = Math.max(...pts.map(p => Math.abs(p[1])), 1);
  const neg = pts.some(p => p[1] < 0), zero = neg ? H / 2 : H - pad, scale = (neg ? H / 2 - pad : H - 2 * pad) / max;
  const bw = (W - 2 * pad) / Math.max(pts.length, 1);
  const every = Math.ceil(pts.length / 12);
  return <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="lab-mapa-bars">
    <line x1={pad} x2={W - pad} y1={zero} y2={zero} stroke="var(--border-subtle, #333)" />
    {pts.map(([x, v], i) => <g key={x + i}>
      <rect x={pad + i * bw + bw * 0.15} width={bw * 0.7} y={v >= 0 ? zero - v * scale : zero} height={Math.abs(v) * scale}
        fill={v >= 0 ? 'var(--green, #4caf50)' : 'var(--red, #e5534b)'}><title>{x}: {v.toLocaleString('es-AR')}{chart.unidad ? ' ' + chart.unidad : ''}</title></rect>
      {i % every === 0 && <text x={pad + i * bw + bw / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--text-secondary, #b5b5b5)">{x}</text>}
    </g>)}
  </svg>;
}

export function MapaChartView({ chart, label }: { chart: MapaChart; label: string }) {
  const host = useRef<HTMLDivElement>(null);
  const bars = chart.series.some(s => s.puntos?.some(p => !isDate(String(p[0]))));
  useEffect(() => {
    if (bars || !host.current || !chart.series.some(s => s.puntos?.length)) return;
    let api: IChartApi | undefined, alive = true, frame = 0;
    // Tamaño a mano y un cuadro después: autoSize medía un contenedor que el propio gráfico agrandaba
    // («ResizeObserver loop completed», owner 19/10).
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { if (host.current) api?.resize(host.current.clientWidth, 200); }); }) : undefined;
    void import('lightweight-charts').then(({ createChart, LineSeries, ColorType }) => {
      if (!alive || !host.current) return;
      const css = getComputedStyle(host.current), v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
      api = createChart(host.current, { width: host.current.clientWidth, height: 200,
        layout: { background: { type: ColorType.Solid, color: v('--bg-secondary', '#141414') }, textColor: v('--text-secondary', '#b5b5b5'), fontSize: 12 },
        grid: { vertLines: { visible: false }, horzLines: { color: '#262626' } },
        timeScale: { borderVisible: false }, rightPriceScale: { borderVisible: false }, handleScroll: false, handleScale: false });
      chart.series.forEach((s, i) => {
        const line = api!.addSeries(LineSeries, { color: v(COLORS[i % COLORS.length], '#c7d2cb'), lineWidth: 2, priceLineVisible: false, lastValueVisible: false,
          priceFormat: { type: 'custom', formatter: (x: number) => x.toLocaleString('es-AR', { maximumFractionDigits: 1 }) } });
        line.setData((s.puntos || []).filter(p => Number.isFinite(p[1])).map(([t, value]) => ({ time: t as Time, value })));
      });
      api.timeScale().fitContent();
      observer?.observe(host.current);
    });
    return () => { alive = false; cancelAnimationFrame(frame); observer?.disconnect(); api?.remove(); };
  }, [chart, bars]);
  return <figure className="lab-mapa-chart">
    {bars ? <CategoryBars chart={chart} label={label} /> : <div ref={host} role="img" aria-label={label} style={{ height: 200 }} />}
    <figcaption>
      {chart.series.map((s, i) => <span key={s.nombre} className="lab-mapa-legend" style={{ color: `var(${COLORS[i % COLORS.length]})` }}>— {s.nombre}</span>)}
      {chart.unidad && <span className="lab-mapa-unit">{chart.unidad}</span>}
      {(chart.fuente || chart.calculo) && <SourceHint text={[chart.fuente && 'Fuente: ' + chart.fuente + (chart.corte ? ', hasta el ' + day(chart.corte) : ''),
        chart.calculo && 'Cálculo en Archivos: ' + chart.calculo.split('/').pop()].filter(Boolean).join(' · ')} />}
    </figcaption>
  </figure>;
}

// Owner 18/10: las fuentes no ocupan lugar; quedan detrás de un «?» que se abre al pasar o tocar.
export function SourceHint({ text }: { text: string }) {
  return <details className="lab-source-hint"><summary aria-label="Fuente" title={text}>?</summary><span>{text}</span></details>;
}

function Numeros({ lines }: { lines: MapaLine[] }) {
  return <div className="lab-mapa-numbers">{lines.map((l, i) => {
    const [value, ...what] = l.text.split('·');
    return <div key={i}><strong>{value.trim()}</strong>{what.length > 0 && <span>{what.join('·').trim()}</span>}</div>;
  })}</div>;
}

// Las secciones en el orden en que las escribe el agente (PRODUCT.md «Mapa de la idea», owner 18/10): cada una con su
// texto, su tabla y su gráfico. Un mapa viejo (Hipótesis, Entrada…) se ve igual de bien.
// «valor · qué es» con un valor corto que lleva cifras = número grande de la evidencia.
const isNumber = (t: string) => { const [v, ...rest] = t.split('·'); return rest.length > 0 && /\d/.test(v) && v.trim().length <= 24; };

function Section({ sec }: { sec: MapaSection }) {
  const numbers = sec.lines.filter(l => isNumber(l.text)), text = sec.lines.filter(l => !isNumber(l.text));
  const empty = !sec.lines.length && !sec.table?.rows.length && !sec.chart;
  return <section className="lab-mapa-block"><h3>{sec.heading}</h3>
    {text.map((l, k) => <p key={k}>{l.text}</p>)}
    {numbers.length > 0 && <Numeros lines={numbers}/>}
    {sec.table && sec.table.rows.length > 0 && <div className="lab-mapa-table"><table><thead><tr>{sec.table.head.map(c => <th key={c}>{c}</th>)}</tr></thead>
      <tbody>{sec.table.rows.map((r, k) => <tr key={k}>{sec.table!.head.map((_, m) => <td key={m}>{r[m] || '—'}</td>)}</tr>)}</tbody></table></div>}
    {sec.chart && <MapaChartView chart={sec.chart} label={sec.heading}/>}
    {empty && <p className="lab-mapa-blank">Todavía no se habló</p>}
  </section>;
}

export function LabMapa({ chatId, running, onResults }: { chatId: string | null; running: boolean; onResults?: () => void }) {
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

  const results = onResults && <button type="button" className="lab-mapa-results" title="Resultados de esta estrategia en Estrategias" onClick={onResults}>Ver resultados<ArrowUpRight size={15}/></button>;
  return <aside className="lab-mapa" aria-label="Mapa de la idea">
    {!mapa && results && <header>{results}</header>}
    {state === 'error' && !mapa ? <p className="lab-mapa-empty" role="alert">No se pudo leer el mapa. Se vuelve a intentar al terminar la próxima respuesta.</p>
      : state === 'loading' && !mapa ? <p className="lab-mapa-empty" role="status">Leyendo el mapa…</p>
      : !mapa ? <p className="lab-mapa-empty">El mapa aparece cuando la conversación arma una idea.</p>
      : <>
        <header><div><h2>{mapa.title || 'Idea'}</h2><span>{running ? 'Actualizando…' : 'Actualizado ' + time(mapa.updatedAt)}{state === 'error' ? ' · no se pudo releer' : ''}</span></div>
          {results}</header>
        <div className="lab-mapa-design">{mapa.sections.map((sec, i) => <Section key={sec.heading + i} sec={sec}/>)}</div>
      </>}
  </aside>;
}
