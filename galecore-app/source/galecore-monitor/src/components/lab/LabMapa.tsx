import { useEffect, useRef } from 'react';
import type { IChartApi, Time } from 'lightweight-charts';
import './LabMapa.css';
import '../shadow/PerformancePanel.css';

// Gráfico y fuente de un informe (WS-0039, WS-0071): los usa LabMarkdown para los bloques ```grafico de los mapas.
export interface MapaChart { fuente?: string; unidad?: string; corte?: string; calculo?: string; series: { nombre: string; puntos: [string, number][] }[] }

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
