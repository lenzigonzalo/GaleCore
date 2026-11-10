import React, { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Gráfico SVG autodescriptivo del panel Argentina: título con unidad, eje X en su unidad (meses «oct-25», días, días al
 * vencimiento), eje Y con marcas y unidad, leyenda, filtro de período y tooltip al pasar el mouse o tocar.
 * Sólo presentación: recorta por período y dibuja lo que la API manda; no calcula nada de negocio.
 */
export interface ChartPoint { t: number; v: number; tag?: string }
export interface ChartSeries { name: string; color: string; kind: 'bar' | 'line'; dashed?: boolean; pts: ChartPoint[]; fmt?: (v: number) => string }
export interface ChartRef { value: number; label: string; color: string; fmt?: (v: number) => string }
type XKind = 'month' | 'day' | 'num';

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const PERIODS = [{ id: '6M', months: 6 }, { id: '1A', months: 12 }, { id: '2A', months: 24 }];
const H = 240, PL = 50, PR = 26, PT = 22, PB = 30;

/** «2026-09-30» → ms UTC del día. */
export const dayMs = (fecha: string) => Date.parse(fecha.slice(0, 10));
const monthStart = (t: number) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };
const addMonths = (t: number, n: number) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate()); };
export const monthShort = (t: number) => { const d = new Date(t); return `${MESES[d.getUTCMonth()]}-${String(d.getUTCFullYear()).slice(2)}`; };
const monthLong = (t: number) => { const d = new Date(t); return `${MESES_LARGO[d.getUTCMonth()]} de ${d.getUTCFullYear()}`; };
const dayShort = (t: number) => { const d = new Date(t); return `${d.getUTCDate()} ${MESES[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`; };
const dayFull = (t: number) => { const d = new Date(t); return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`; };
const numAr = (v: number, d = 0) => v.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Marcas «redondas» (1, 2, 5 × 10ⁿ) entre min y max, 3 a 5 en total. */
export function niceTicks(min: number, max: number, target = 4): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const build = (step: number) => {
    const out: number[] = [];
    for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Math.round(v / step) * step);
    return out;
  };
  const steps = [1, 2, 2.5, 5, 10].map(m => m * mag).concat([20, 50].map(m => m * mag));
  // el paso más grande que deja entre 3 y 5 marcas; si ninguno, el que más se acerque
  const fit = steps.filter(st => { const n = build(st).length; return n >= 3 && n <= 5; });
  return fit.length ? build(fit[fit.length - 1]) : build(steps.find(st => st >= raw) ?? mag);
}

export function SeriesChart({ title, xKind, series, refs, yTick, yCaption, xCaption, ariaLabel, defaultPeriod }: {
  title: string; xKind: XKind; series: ChartSeries[]; refs?: ChartRef[];
  /** Formato de las marcas del eje Y (con unidad corta: «2 %»). */
  yTick: (v: number) => string; yCaption?: string; xCaption?: string; ariaLabel?: string; defaultPeriod?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  const [period, setPeriod] = useState<string | null>(defaultPeriod ?? null);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = () => { const w = el.clientWidth; if (w > 0) setWidth(w); };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // x en el mismo instante: en mensual todo cae al día 1 del mes (la barra y la línea del mismo mes coinciden).
  const norm = (t: number) => xKind === 'month' ? monthStart(t) : t;
  const all = useMemo(() => series.map(s => ({ ...s, pts: s.pts.map(p => ({ ...p, t: norm(p.t) })).filter(p => !isNaN(p.t)).sort((a, b) => a.t - b.t) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, xKind]);
  const allT = all.flatMap(s => s.pts.map(p => p.t));
  const tMin = allT.length ? Math.min(...allT) : 0, tMax = allT.length ? Math.max(...allT) : 0;
  const spanMonths = xKind === 'num' ? 0 : (tMax - tMin) / (30.44 * 86400000);
  const periods = spanMonths >= 7 ? PERIODS.filter(p => p.months <= spanMonths + 1.5) : [];
  const active = period && periods.some(p => p.id === period) ? PERIODS.find(p => p.id === period)! : null;
  const cutoff = active ? addMonths(tMax, -active.months) : -Infinity;
  const view = all.map(s => ({ ...s, pts: s.pts.filter(p => xKind === 'month' ? p.t > cutoff : p.t >= cutoff) }));
  const vT = view.flatMap(s => s.pts.map(p => p.t));
  if (vT.length === 0) return null;

  const hasBars = view.some(s => s.kind === 'bar');
  const vals = [...view.flatMap(s => s.pts.map(p => p.v)), ...(refs ?? []).map(r => r.value)];
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hasBars) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  if (hi === lo) { hi += Math.abs(hi) * 0.1 || 1; lo -= Math.abs(lo) * 0.1 || 1; }
  if (!hasBars) { const pad = (hi - lo) * 0.08; lo -= pad; hi += pad; }
  const yTicks = niceTicks(lo, hi, 4);
  const y0 = Math.min(lo, yTicks[0] ?? lo), y1 = Math.max(hi, yTicks[yTicks.length - 1] ?? hi);

  const t0 = Math.min(...vT), t1 = Math.max(...vT);
  const uniq = Array.from(new Set(vT)).sort((a, b) => a - b);
  const gap = uniq.length > 1 ? Math.min(...uniq.slice(1).map((t, i) => t - uniq[i])) : 1;
  const barW = (hasBars ? 0.6 : 0);
  const padT = hasBars ? gap / 2 : (xKind === 'num' ? (t1 - t0) * 0.03 : 0);
  const plotW = Math.max(120, width - PL - PR), plotH = H - PT - PB;
  const xa = t0 - padT, xb = t1 + padT || t0 + 1;
  const sx = (t: number) => PL + ((t - xa) / ((xb - xa) || 1)) * plotW;
  const sy = (v: number) => PT + (1 - (v - y0) / ((y1 - y0) || 1)) * plotH;
  const bw = Math.max(3, Math.min(34, (gap / ((xb - xa) || 1)) * plotW * barW));

  // marcas del eje X
  const xTicks: { t: number; label: string }[] = [];
  if (xKind === 'month') {
    const labelW = 50;
    const step = Math.max(1, Math.ceil(uniq.length * labelW / plotW));
    for (let i = uniq.length - 1; i >= 0; i -= step) xTicks.unshift({ t: uniq[i], label: monthShort(uniq[i]) });
  } else if (xKind === 'day') {
    const n = Math.max(2, Math.min(6, Math.floor(plotW / 72)));
    for (let i = 0; i < n; i++) { const t = t0 + ((t1 - t0) * i) / (n - 1); xTicks.push({ t, label: dayShort(t) }); }
  } else {
    [30, 60, 90, 120, 180, 270, 360, 540, 720, 1080, 1440].filter(d => d >= xa && d <= xb && (sx(d) - PL) > 0).forEach(d => xTicks.push({ t: d, label: String(d) }));
    // sin amontonar: deja una marca cada ≥ 30 px
    let last = -1e9;
    for (let i = 0; i < xTicks.length; i++) { if (sx(xTicks[i].t) - last < 30) { xTicks.splice(i, 1); i--; } else last = sx(xTicks[i].t); }
  }

  const xFull = (t: number) => xKind === 'month' ? monthLong(t) : xKind === 'day' ? dayFull(t) : `${numAr(t)} días`;
  const nearestT = (px: number) => {
    const t = xa + ((px - PL) / plotW) * (xb - xa);
    return uniq.reduce((best, u) => Math.abs(u - t) < Math.abs(best - t) ? u : best, uniq[0]);
  };
  const setFromEvent = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * width;
    setHover(px < PL - 4 || px > width - PR + 4 ? null : nearestT(px));
  };
  const rows = hover == null ? [] : view.flatMap(s => {
    const p = s.pts.reduce<ChartPoint | null>((b, q) => !b || Math.abs(q.t - hover) < Math.abs(b.t - hover) ? q : b, null);
    const tol = xKind === 'month' ? 16 * 86400000 : xKind === 'day' ? 5 * 86400000 : Infinity;
    return p && Math.abs(p.t - hover) <= tol ? [{ name: p.tag ? `${s.name} (${p.tag})` : s.name, color: s.color, text: (s.fmt ?? yTick)(p.v) }] : [];
  });
  const tipLeft = hover == null ? 0 : Math.min(Math.max(sx(hover), 90), width - 90);

  return <figure className="ar-chart" ref={host} aria-label={ariaLabel ?? title}>
    <figcaption>
      <h3>{title}</h3>
      {periods.length > 0 && <div className="per" role="group" aria-label="Período">
        {periods.map(p => <button key={p.id} className={active?.id === p.id ? 'on' : ''} aria-pressed={active?.id === p.id}
          onClick={() => setPeriod(active?.id === p.id ? null : p.id)}>{p.id}</button>)}
      </div>}
    </figcaption>
    <div className="key-row">{series.map(s => <span className="key" key={s.name}><i className={s.kind} style={{ background: s.dashed ? undefined : s.color, borderColor: s.color }} data-dashed={s.dashed ? '1' : undefined} />{s.name}</span>)}
      {(refs ?? []).map(r => <span className="key" key={r.label}><i className="line" data-dashed="1" style={{ borderColor: r.color }} />{r.label}</span>)}</div>
    <div className="plot">
      <svg viewBox={`0 0 ${width} ${H}`} width={width} height={H} role="img" aria-label={ariaLabel ?? title}
        onPointerMove={setFromEvent} onPointerDown={setFromEvent} onPointerLeave={e => { if (e.pointerType === 'mouse') setHover(null); }}>
        {yCaption && <text x={4} y={11} className="axcap">{yCaption}</text>}
        {yTicks.map(v => <g key={v}>
          <line x1={PL} x2={width - PR} y1={sy(v)} y2={sy(v)} className={v === 0 && hasBars ? 'zero' : 'grid'} />
          <text x={PL - 6} y={sy(v) + 4} textAnchor="end" className="tick">{yTick(v)}</text>
        </g>)}
        {xTicks.map(tk => <g key={tk.t}>
          <line x1={sx(tk.t)} x2={sx(tk.t)} y1={PT + plotH} y2={PT + plotH + 4} className="grid" />
          <text x={sx(tk.t)} y={H - 10} textAnchor="middle" className="tick">{tk.label}</text>
        </g>)}
        {hover != null && <line x1={sx(hover)} x2={sx(hover)} y1={PT} y2={PT + plotH} className="cross" />}
        {view.map((s, i) => s.kind === 'bar'
          ? s.pts.map(p => <rect key={`${i}-${p.t}`} x={sx(p.t) - bw / 2} width={bw} y={Math.min(sy(p.v), sy(0))} height={Math.max(1, Math.abs(sy(p.v) - sy(0)))}
            fill={s.color} opacity={hover == null || hover === p.t ? 1 : 0.55} rx="1.5" />)
          : <polyline key={i} points={s.pts.map(p => `${sx(p.t)},${sy(p.v)}`).join(' ')} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round"
            strokeDasharray={s.dashed ? '6 5' : undefined} />)}
        {view.map((s, i) => s.kind === 'line' && (s.pts.length <= 30 || hover != null) ? s.pts.filter(p => s.pts.length <= 30 || p.t === hover)
          .map(p => <circle key={`d${i}-${p.t}`} cx={sx(p.t)} cy={sy(p.v)} r={hover === p.t ? 4.5 : 2.5} fill={s.color} />) : null)}
        {(refs ?? []).map(r => <line key={r.label} x1={PL} x2={width - PR} y1={sy(r.value)} y2={sy(r.value)} stroke={r.color} strokeWidth="2" strokeDasharray="6 5" />)}
      </svg>
      {hover != null && rows.length > 0 && <div className="tip" role="status" style={{ left: tipLeft }}>
        <b>{xFull(hover)}</b>
        {rows.map(r => <div key={r.name}><i style={{ background: r.color }} />{r.name}<strong>{r.text}</strong></div>)}
        {(refs ?? []).map(r => <div key={r.label}><i style={{ background: r.color }} />{r.label}</div>)}
      </div>}
    </div>
    {xCaption && <div className="xcap">{xCaption}</div>}
  </figure>;
}
