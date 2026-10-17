import { useEffect, useRef, useState } from 'react';
import type { IChartApi, Time } from 'lightweight-charts';
import { labRequest } from '../../api/lab';
import './LabMapa.css';
import '../shadow/PerformancePanel.css';

// Mapa de la idea (WS-0039): lo escribe el agente en memory/mapa-<tema>.md y el Lab lo sirve por secciones.
// El panel sólo lee; se relee al abrir la conversación y al terminar cada respuesta.
// Owner 17/10: se ve como la solapa Diseño de Estrategias — hipótesis, objetivo, las reglas por bloque en las mismas
// tablas, los datos como la solapa Datos y la evidencia con sus gráficos. Lo que todavía no se habló queda vacío.
export interface MapaLine { mark: 'ok' | 'missing' | null; text: string }
export interface MapaChart { fuente?: string; unidad?: string; corte?: string; calculo?: string; series: { nombre: string; puntos: [string, number][] }[] }
export interface MapaSection { heading: string; lines: MapaLine[]; chart?: MapaChart; table?: { head: string[]; rows: string[][] } }
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

// Las secciones del diseño, en el orden de la solapa Diseño; Datos y Evidencia al final.
const STATEMENTS = ['Hipótesis', 'Objetivo'];
const RULES = ['Entrada', 'Construcción', 'Gestión', 'Salida', 'Riesgo y tamaño'];
const RULE_HEAD = ['Concepto', 'Condición', 'Umbral', 'Acción'];
const DATA_HEAD = ['Dato', 'Para qué', 'Fuente', 'Historia'];
const norm = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
// «valor · qué es» con un valor corto que lleva cifras = número grande de la evidencia.
const isNumber = (t: string) => { const [v, ...rest] = t.split('·'); return rest.length > 0 && /\d/.test(v) && v.trim().length <= 24; };

function DesignTable({ title, head, section, strategy }: { title: string; head: string[]; section?: MapaSection; strategy: boolean }) {
  if (!section && !strategy) return null;
  const rows = section?.table?.rows || [], columns = section?.table?.head?.length ? section.table.head : head;
  return <section className="algorithm-section lab-mapa-block"><h3>{title}</h3>
    {rows.length ? <table><thead><tr>{columns.map(c => <th key={c}>{c}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={i}>{columns.map((_, j) => <td key={j}>{r[j] || '—'}</td>)}</tr>)}</tbody></table>
      : section?.lines.length ? section.lines.map((l, i) => <p key={i}>{l.text}</p>)
      : <p className="lab-mapa-blank">Sin definir todavía</p>}
  </section>;
}

export function LabMapa({ chatId, running, strategy = false }: { chatId: string | null; running: boolean; strategy?: boolean }) {
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
        {(() => {
          const find = (name: string) => mapa.sections.find(x => norm(x.heading) === norm(name));
          const known = [...STATEMENTS, ...RULES, 'Datos', 'Evidencia'].map(norm);
          const evidence = [find('Evidencia'), ...mapa.sections.filter(x => !known.includes(norm(x.heading)))].filter((x): x is MapaSection => !!x);
          return <div className="algorithm-design lab-mapa-design">
            {STATEMENTS.map(name => { const sec = find(name); return (sec || strategy) && <section key={name} className="lab-mapa-statement"><h3>{name}</h3>{sec?.lines.length ? sec.lines.map((l, k) => <p key={k}>{l.text}</p>) : <p className="lab-mapa-blank">Sin definir todavía</p>}</section>; })}
            {RULES.map(name => <DesignTable key={name} title={name} head={RULE_HEAD} section={find(name)} strategy={strategy}/>)}
            <DesignTable title="Datos" head={DATA_HEAD} section={find('Datos')} strategy={strategy}/>
            {evidence.map(sec => <section key={sec.heading} className="lab-mapa-block lab-mapa-evidence"><h3>{sec.heading}</h3>
              {sec.lines.some(l => isNumber(l.text)) && <Numeros lines={sec.lines.filter(l => isNumber(l.text))}/>}
              {sec.chart && <MapaChartView chart={sec.chart} label={sec.heading}/>}
              {sec.table && <table><thead><tr>{sec.table.head.map(c => <th key={c}>{c}</th>)}</tr></thead><tbody>{sec.table.rows.map((r, k) => <tr key={k}>{sec.table!.head.map((_, m) => <td key={m}>{r[m] || '—'}</td>)}</tr>)}</tbody></table>}
              {sec.lines.filter(l => !isNumber(l.text)).map((l, k) => <p key={k}>{l.text}</p>)}
            </section>)}
          </div>;
        })()}
      </>}
  </aside>;
}
