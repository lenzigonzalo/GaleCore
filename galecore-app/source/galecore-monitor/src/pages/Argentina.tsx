import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArgentinaBlock, ArgentinaBoard, ArgentinaDolar, ArgentinaFuturo, ArgentinaLetra, ArgentinaPoint, ArgentinaSeriesItem,
  fetchArgentinaBoard,
} from '../api/argentina';
import { MacroChart } from '../components/macro/MacroChart';
import { ChartPoint, dayMs, SeriesChart } from '../components/macro/SeriesChart';
import './Macro.css';
import './Argentina.css';

/**
 * Argentina (WS-0095): el país en una pantalla «para tradear». Todo viene armado de `GET /App/Macro/Argentina`
 * (variaciones, brecha, devaluación implícita, interanual, curvas); acá sólo se formatea y se dibuja.
 */

const REFRESH_MS = 60_000;

const num = (v: number | null | undefined, d = 2) => v == null ? '—' : v.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v: number | null | undefined, d = 2) => v == null ? '—' : `${num(v, d)} %`;
const signed = (v: number | null | undefined, unit = '%', d = 2) => v == null ? '—'
  : `${v > 0 ? '+' : v < 0 ? '−' : ''}${num(Math.abs(v), d)}${unit ? ` ${unit}` : ''}`;
const tone = (v: number | null | undefined) => v == null || v === 0 ? undefined : v > 0 ? 'pos' : 'neg';
const usdM = (v: number | null | undefined) => v == null ? '—' : `US$ ${num(v, 0)} M`;
const usdBn = (v: number | null | undefined) => v == null ? '—' : `${num(v / 1000, 1)} mil M`;
const arsBillions = (v: number | null | undefined) => v == null ? '—' : `$ ${num(v / 1e6, 1)} billones`;

/** «2026-11-10» → «10/11/2026»; con hora, día/mes y hora local. */
export function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) || s.endsWith('T00:00:00')) return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
  const d = new Date(s);
  if (!isNaN(d.getTime()) && s.includes('T')) {
    return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  }
  return s;
}
const SOURCES: Record<string, string> = { dolarapi: 'DolarAPI', argentinadatos: 'ArgentinaDatos', bcra: 'BCRA', indec: 'INDEC', byma: 'BYMA', 'a3-web': 'A3 Mercados', a3: 'A3' };
const src = (s: string | null | undefined) => s ? (SOURCES[s] ?? s) : '';

interface Detail { title: string; values: { label: string; value: string; cls?: string }[]; points: ArgentinaPoint[]; unit: string; meta: string }
type Open = (d: Detail) => void;

/** lightweight-charts exige fechas únicas y crecientes; la serie diaria de ArgentinaDatos repite días. */
const chartPoints = (pts: ArgentinaPoint[]) => {
  const byDay = new Map<string, number>();
  pts.forEach(p => byDay.set(p.fecha.slice(0, 10), p.valor));
  return Array.from(byDay.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value }));
};

// ───── gráficos (SeriesChart: ejes, leyenda, período y tooltip) ─────
const toPts = (s: ArgentinaPoint[]): ChartPoint[] => s.map(p => ({ t: dayMs(p.fecha), v: p.valor }));
const ACCENT = 'var(--accent, #c7d2cb)', GREEN = 'var(--green)', MUTED = '#8b8b8b';
const mon = (f?: string | null) => f ? `${f.slice(5, 7)}/${f.slice(2, 4)}` : '';
const tickNum = (v: number) => num(v, 0);

// ───── tarjetas ─────
function Card({ title, block, wide, children }: { title: string; block?: ArgentinaBlock<any>; wide?: boolean; children?: React.ReactNode }) {
  return <section className={`ar-card${wide ? ' wide' : ''}`} aria-label={title}>
    <header><h2>{title}</h2>{block?.ok && <span>{[src(block.source), fmtDate(block.asOf)].filter(s => s && s !== '—').join(' · ')}</span>}</header>
    {!block ? <p className="ar-missing">Sin datos del servidor.</p> : !block.ok ? <p className="ar-missing">{block.error || 'Sin datos.'}</p> : children}
  </section>;
}

const seriesDetail = (s: ArgentinaSeriesItem, valueFmt: (v: number | null) => string): Detail => ({
  title: s.name, unit: s.unit.includes('%') ? '%' : '', points: s.series, meta: `${src(s.source)} · ${fmtDate(s.date)}`,
  values: [{ label: 'Último', value: valueFmt(s.last) }, { label: 'Cambio', value: s.unit.includes('%') ? signed(s.changeAbs, 'pts') : signed(s.changePct), cls: tone(s.changeAbs) }],
});

function Dolares({ b, open }: { b: ArgentinaBlock<ArgentinaDolar[]>; open: Open }) {
  return <div className="ar-scroll"><table className="ar-table">
    <thead><tr><th>Casa</th><th>Compra</th><th>Venta</th><th>Brecha</th><th>Var. diaria</th></tr></thead>
    <tbody>{b.data!.map(q => <tr key={q.casa} className="click" onClick={() => open({
      title: `Dólar ${q.nombre}`, unit: '', points: q.serie, meta: `${src(b.source)} · ${fmtDate(q.fechaActualizacion)}`,
      values: [{ label: 'Compra', value: num(q.compra) }, { label: 'Venta', value: num(q.venta) }, { label: 'Brecha', value: pct(q.brechaPct) },
        { label: 'Var. diaria', value: signed(q.varDiariaPct), cls: tone(q.varDiariaPct) }],
    })}>
      <td><button className="ar-rowbtn">{q.nombre}</button></td><td>{num(q.compra)}</td><td>{num(q.venta)}</td><td>{pct(q.brechaPct)}</td>
      <td className={tone(q.varDiariaPct)} title={q.varDiariaContra ? `Contra el ${fmtDate(q.varDiariaContra)}` : undefined}>{signed(q.varDiariaPct)}</td>
    </tr>)}</tbody>
  </table></div>;
}

function Futuros({ b, dolar }: { b: ArgentinaBlock<{ referencia: { a3500: number | null; a3500Fecha: string | null }; contratos: ArgentinaFuturo[] }>; dolar?: boolean }) {
  const ref = b.data!.referencia;
  const rows = b.data!.contratos;
  return <>
    {dolar && ref?.a3500 != null && <div className="ar-nums"><div><span>A3500 · {fmtDate(ref.a3500Fecha)}</span><strong>{num(ref.a3500)}</strong></div></div>}
    {rows.length === 0 ? <p className="ar-missing">A3 no devolvió contratos.</p> : <div className="ar-scroll"><table className="ar-table">
      <thead><tr><th>Contrato</th>{dolar && <th>Vence</th>}<th>Precio</th>{dolar ? <><th>Devaluación</th><th>TNA</th></> : <th>Var.</th>}</tr></thead>
      <tbody>{rows.map(f => <tr key={f.ticker}><td>{f.ticker}</td>{dolar && <td>{fmtDate(f.vencimiento)}</td>}<td>{num(f.ajuste ?? f.ultimo)}</td>
        {dolar ? <><td>{pct(f.devaluacionPct)}</td><td>{pct(f.tnaPct)}</td></> : <td className={tone(f.variacionPct)}>{signed(f.variacionPct)}</td>}</tr>)}</tbody>
    </table></div>}
  </>;
}

function Inflacion({ b }: { b: ArgentinaBlock<NonNullable<ArgentinaBoard['blocks']['inflacion']>['data']> }) {
  const { mensual, interanual, rem } = b.data!;
  const hasRemHistory = rem.ok && rem.series.length > 1;
  const remName = `Esperada próximos 12 meses (REM BCRA): ${pct(rem.last, 1)} · relevamiento ${fmtDate(rem.date)}`;
  return <>
    <div className="ar-nums">
      <div><span>Último mes · {mon(mensual.date)}</span><strong>{pct(mensual.last)}</strong></div>
      <div><span>Últimos 12 meses</span><strong>{interanual.ok ? pct(interanual.last) : '—'}</strong></div>
      <div><span>Esperada próx. 12 meses (REM)</span><strong>{rem.ok ? pct(rem.last) : '—'}</strong></div>
    </div>
    <div className="ar-pair">
      <SeriesChart title="Inflación mensual (% respecto del mes anterior)" xKind="month" yCaption="% mensual" xCaption="Mes (una barra por mes)"
        yTick={v => pct(v, 1)} series={[{ name: 'Inflación del mes, %', color: ACCENT, kind: 'bar', pts: toPts(mensual.series), fmt: v => pct(v, 2) }]} />
      {interanual.ok ? <SeriesChart title="Inflación de los últimos 12 meses vs. esperada (% anual)" xKind="month" yCaption="% anual" xCaption="Mes en que termina cada período de 12 meses" defaultPeriod="1A"
        yTick={v => pct(v, 0)}
        series={[{ name: 'Inflación de los últimos 12 meses, %', color: ACCENT, kind: 'line', pts: toPts(interanual.series), fmt: v => pct(v, 1) },
          ...(hasRemHistory ? [{ name: remName, color: GREEN, kind: 'line' as const, dashed: true, pts: toPts(rem.series), fmt: (v: number) => pct(v, 1) }] : [])]}
        refs={rem.ok && !hasRemHistory && rem.last != null ? [{ value: rem.last, label: remName, color: GREEN }] : []} />
        : <p className="ar-missing">Sin 12 meses consecutivos para la inflación de los últimos 12 meses.</p>}
    </div>
    {!rem.ok && <p className="ar-missing">REM: {rem.error}</p>}
  </>;
}

function CurvaPesos({ b }: { b: ArgentinaBlock<ArgentinaLetra[]> }) {
  const rows = b.data!;
  const pts: ChartPoint[] = rows.filter(r => r.dias != null && r.tnaPct != null).map(r => ({ t: r.dias!, v: r.tnaPct!, tag: r.ticker })).sort((a, c) => a.t - c.t);
  return <>
    {pts.length > 1 && <SeriesChart title="Curva de tasas en pesos: TNA según los días que faltan para vencer" xKind="num" yCaption="TNA %" xCaption="Días al vencimiento"
      yTick={v => pct(v, 0)} series={[{ name: 'TNA de cada letra, %', color: ACCENT, kind: 'line', pts, fmt: v => pct(v, 2) }]} />}
    <div className="ar-scroll"><table className="ar-table">
      <thead><tr><th>Letra</th><th>Vence</th><th>Días</th><th>Precio</th><th>TNA</th><th>TEM</th></tr></thead>
      <tbody>{rows.map(l => <tr key={l.ticker}><td>{l.ticker}</td><td>{fmtDate(l.vencimiento)}</td><td>{l.dias ?? '—'}</td><td>{num(l.precio)}</td><td>{pct(l.tnaPct)}</td><td>{pct(l.temPct)}</td></tr>)}</tbody>
    </table></div>
  </>;
}

function Nivel({ s, fmt, open }: { s: ArgentinaSeriesItem; fmt: (v: number | null) => string; open: Open }) {
  return <button className="ar-stat" onClick={() => open(seriesDetail(s, fmt))}>
    <span>{s.name} · {fmtDate(s.date)}</span><strong>{fmt(s.last)}</strong><em className={tone(s.changeAbs)}>{signed(s.changePct)}</em>
  </button>;
}

function Tasas({ items, open }: { items: ArgentinaSeriesItem[]; open: Open }) {
  return <div className="ar-scroll"><table className="ar-table">
    <thead><tr><th>Tasa</th><th>Último</th><th>Cambio</th><th>Fecha</th></tr></thead>
    <tbody>{items.map(s => s.ok
      ? <tr key={s.id} className="click" onClick={() => open(seriesDetail(s, v => pct(v)))}><td><button className="ar-rowbtn">{s.name}</button></td><td>{pct(s.last)}</td>
        <td className={tone(s.changeAbs)}>{signed(s.changeAbs, 'pts')}</td><td>{fmtDate(s.date)}</td></tr>
      : <tr key={s.id}><td>{s.name}</td><td className="off" colSpan={3}>{s.error}</td></tr>)}</tbody>
  </table></div>;
}

function Balanza({ items }: { items: ArgentinaSeriesItem[] }) {
  const [expo, impo, saldo] = items;
  return <>
    <div className="ar-nums">{items.filter(i => i.ok).map(i => <div key={i.id}><span>{i.name} · {mon(i.date)}</span><strong className={i === saldo ? tone(i.last) : undefined}>{usdM(i.last)}</strong></div>)}</div>
    {expo?.ok && impo?.ok && <SeriesChart title="Exportaciones e importaciones por mes (US$ millones)" xKind="month" yCaption="US$ millones" xCaption="Mes"
      yTick={tickNum} series={[{ name: 'Exportaciones', color: GREEN, kind: 'line', pts: toPts(expo.series), fmt: usdM }, { name: 'Importaciones', color: MUTED, kind: 'line', pts: toPts(impo.series), fmt: usdM }]} />}
    {items.filter(i => !i.ok).map(i => <p className="ar-missing" key={i.id}>{i.name}: {i.error}</p>)}
  </>;
}

function Skeleton() {
  return <div className="ar-page" role="status" aria-label="Leyendo Argentina">
    <div className="ar-head"><h1>Argentina</h1></div>
    <div className="ar-strip">{Array.from({ length: 7 }, (_, i) => <div key={i} className="ar-sk line" />)}</div>
    <div className="ar-grid">{Array.from({ length: 6 }, (_, i) => <div key={i} className="ar-sk" />)}</div>
  </div>;
}

export function Argentina() {
  const [board, setBoard] = useState<ArgentinaBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [dPeriod, setDPeriod] = useState<number | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const dialog = useRef<HTMLElement>(null);

  const load = useCallback((signal?: AbortSignal) => fetchArgentinaBoard(signal)
    .then(b => { setBoard(b); setError(null); })
    .catch(e => { if (!signal?.aborted) setError(e?.response?.data?.error || e?.message || 'No se pudo leer Argentina.'); }), []);
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    const timer = setInterval(() => load(controller.signal), REFRESH_MS);
    return () => { controller.abort(); clearInterval(timer); };
  }, [load]);
  useEffect(() => { if (detail) dialog.current?.focus(); else opener.current?.focus(); }, [detail]);
  const open: Open = d => { opener.current = document.activeElement as HTMLElement | null; setDPeriod(null); setDetail(d); };

  if (error && !board) return <div className="ar-page"><p role="alert" className="macro-attention">{error} <button onClick={() => load()}>Reintentar</button></p></div>;
  if (!board) return <Skeleton />;

  const bl = board.blocks;
  const casa = (id: string) => bl.dolares?.ok ? bl.dolares.data!.find(q => q.casa === id) : undefined;
  const dolarStat = (label: string, q?: ArgentinaDolar) => q
    ? <button className="ar-stat" key={label} onClick={() => open({ title: `Dólar ${q.nombre}`, unit: '', points: q.serie, meta: `${src(bl.dolares!.source)} · ${fmtDate(q.fechaActualizacion)}`,
      values: [{ label: 'Venta', value: num(q.venta) }, { label: 'Brecha', value: pct(q.brechaPct) }, { label: 'Var. diaria', value: signed(q.varDiariaPct), cls: tone(q.varDiariaPct) }] })}>
      <span>{label}</span><strong>{num(q.venta)}</strong><em className={tone(q.varDiariaPct)}>{signed(q.varDiariaPct)}</em></button>
    : <div className="ar-stat off" key={label}><span>{label}</span><strong>—</strong></div>;
  const serieStat = (label: string, block: ArgentinaBlock<ArgentinaSeriesItem> | undefined, fmt: (v: number | null) => string, change: (s: ArgentinaSeriesItem) => string) =>
    block?.ok && block.data ? <button className="ar-stat" key={label} onClick={() => open(seriesDetail(block.data!, fmt))}>
      <span>{label}</span><strong>{fmt(block.data.last)}</strong><em className={tone(block.data.changeAbs)}>{change(block.data)}</em></button>
      : <div className="ar-stat off" key={label} title={block?.error ?? undefined}><span>{label}</span><strong>—</strong></div>;
  const ccl = casa('contadoconliqui');
  const infl = bl.inflacion?.ok ? bl.inflacion.data!.mensual : undefined;
  const res = bl.reservas?.ok ? bl.reservas.data! : undefined;

  return <div className="ar-page">
    <div className="ar-head"><h1>Argentina</h1><span>Actualizado {fmtDate(board.asOf)}</span></div>
    <div className="ar-strip">
      {dolarStat('Oficial', casa('oficial'))}
      {dolarStat('MEP', casa('bolsa'))}
      {dolarStat('CCL', ccl)}
      {ccl ? <div className="ar-stat"><span>Brecha CCL</span><strong>{pct(ccl.brechaPct, 1)}</strong></div> : <div className="ar-stat off"><span>Brecha CCL</span><strong>—</strong></div>}
      {serieStat('Riesgo país', bl.riesgoPais, v => v == null ? '—' : `${num(v, 0)} pb`, s => signed(s.changeAbs, 'pb', 0))}
      {serieStat('Reservas, US$', bl.reservas, usdBn, s => signed(s.changeAbs, 'M', 0))}
      {infl ? <button className="ar-stat" onClick={() => open(seriesDetail(infl, v => pct(v)))}><span>Inflación {mon(infl.date)}</span><strong>{pct(infl.last)}</strong>
        <em className={tone(infl.changeAbs)}>{signed(infl.changeAbs, 'pts')}</em></button> : <div className="ar-stat off"><span>Inflación último mes</span><strong>—</strong></div>}
    </div>
    <div className="ar-grid">
      <Card title="Dólares" block={bl.dolares}>{bl.dolares?.ok && <Dolares b={bl.dolares} open={open} />}</Card>
      <Card title="Futuros de dólar" block={bl.futurosDolar}>{bl.futurosDolar?.ok && <Futuros b={bl.futurosDolar} dolar />}</Card>
      <Card title="Inflación vs REM" block={bl.inflacion} wide>{bl.inflacion?.ok && <Inflacion b={bl.inflacion} />}</Card>
      <Card title="Curva en pesos" block={bl.curvaPesos}>{bl.curvaPesos?.ok && <CurvaPesos b={bl.curvaPesos} />}</Card>
      <Card title="Reservas y base" block={bl.reservas?.ok ? bl.reservas : bl.baseMonetaria}>
        <div className="ar-nums">
          {res && <Nivel s={res} fmt={usdM} open={open} />}
          {bl.baseMonetaria?.ok && <Nivel s={bl.baseMonetaria.data!} fmt={arsBillions} open={open} />}
        </div>
        {res && <SeriesChart title="Reservas internacionales (US$ millones, diario)" xKind="day" yCaption="US$ millones" defaultPeriod="1A"
          yTick={tickNum} series={[{ name: 'Reservas internacionales', color: ACCENT, kind: 'line', pts: toPts(res.series), fmt: usdM }]} />}
        {!bl.reservas?.ok && <p className="ar-missing">Reservas: {bl.reservas?.error}</p>}
        {!bl.baseMonetaria?.ok && <p className="ar-missing">Base monetaria: {bl.baseMonetaria?.error}</p>}
      </Card>
      <Card title="Tasas" block={bl.tasas}>{bl.tasas?.ok && <Tasas items={bl.tasas.data!} open={open} />}</Card>
      <Card title="Balanza comercial" block={bl.balanza}>{bl.balanza?.ok && <Balanza items={bl.balanza.data!} />}</Card>
      <Card title="Agro" block={bl.agro}>{bl.agro?.ok && <Futuros b={bl.agro as any} />}</Card>
    </div>
    {detail && <div className="macro-detail-backdrop" onClick={() => setDetail(null)}>
      <section className="macro-detail" role="dialog" aria-modal="true" aria-label={detail.title} tabIndex={-1} ref={dialog}
        onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); setDetail(null); } }}>
        <button className="macro-close" onClick={() => setDetail(null)}>Cerrar · Esc</button>
        <h2>{detail.title}</h2>
        <div className="macro-detail-values">{detail.values.map(v => <div key={v.label}><span>{v.label}</span><strong className={v.cls}>{v.value}</strong></div>)}</div>
        {(() => {
          const all = chartPoints(detail.points);
          const last = all.length ? Date.parse(all[all.length - 1].date) : 0;
          const first = all.length ? Date.parse(all[0].date) : 0;
          const span = (last - first) / (30.44 * 86400000);
          const opts = [{ id: '6M', m: 6 }, { id: '1A', m: 12 }, { id: '2A', m: 24 }].filter(o => span >= 7 && o.m <= span + 1.5);
          const shown = dPeriod == null ? all : all.filter(p => Date.parse(p.date) >= new Date(last).setUTCMonth(new Date(last).getUTCMonth() - dPeriod));
          return <>
            {opts.length > 0 && <div className="ar-chart"><div className="per" role="group" aria-label="Período">
              {opts.map(o => <button key={o.id} className={dPeriod === o.m ? 'on' : ''} aria-pressed={dPeriod === o.m} onClick={() => setDPeriod(dPeriod === o.m ? null : o.m)}>{o.id}</button>)}
            </div></div>}
            <MacroChart points={shown} unit={detail.unit} label={`${detail.title}, ${dPeriod ? `últimos ${dPeriod} meses` : 'toda la serie'}`} />
          </>;
        })()}
        <p>{detail.meta}</p>
      </section>
    </div>}
  </div>;
}
