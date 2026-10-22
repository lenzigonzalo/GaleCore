import React from 'react';
import { GexExpiryApi } from '../../types/gex';
import { fmtExpiry } from '../../utils/formatters';

/**
 * Smile de volatilidad: IV por strike de un vencimiento, con los de comparación debajo en tenue.
 * Dibuja lo que la API sirve (IV por strike y por lado): del lado de las puts los strikes bajo el spot y del de las
 * calls los de arriba, que son las opciones fuera del dinero, como en cualquier smile. No calcula nada.
 */
const W = 760, H = 300, PAD = { l: 46, r: 16, t: 16, b: 30 };
const COLORS = ['#60a5fa', '#a78bfa', '#f59e0b', '#34d399'];

interface Point { strike: number; iv: number }

function otmPoints(e: GexExpiryApi, spot: number): Point[] {
  return e.strikes
    .map((s) => ({ strike: s.strike, iv: (s.strike <= spot ? s.putIV : s.callIV) ?? 0 }))
    .filter((p) => p.iv > 0 && Math.abs(p.strike / spot - 1) <= 0.12)
    .map((p) => ({ strike: p.strike, iv: p.iv * 100 }))
    .sort((a, b) => a.strike - b.strike);
}

export function VolSmile({ main, others, spot }: { main: GexExpiryApi | null; others: GexExpiryApi[]; spot: number }) {
  const series = [main, ...others].filter((e): e is GexExpiryApi => !!e)
    .map((e, i) => ({ e, pts: otmPoints(e, spot), color: COLORS[i % COLORS.length], primary: i === 0 }))
    .filter((s) => s.pts.length > 1);
  if (!series.length || !(spot > 0)) {
    return <div className="vol-smile-empty">Sin IV por strike para este vencimiento.</div>;
  }
  const all = series.flatMap((s) => s.pts);
  const xs = all.map((p) => p.strike), ys = all.map((p) => p.iv);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const lo = Math.min(...ys), hi = Math.max(...ys), pad = Math.max((hi - lo) * 0.1, 0.5);
  const y0 = lo - pad, y1 = hi + pad;
  const X = (v: number) => PAD.l + ((v - x0) / (x1 - x0 || 1)) * (W - PAD.l - PAD.r);
  const Y = (v: number) => H - PAD.b - ((v - y0) / (y1 - y0 || 1)) * (H - PAD.t - PAD.b);
  const yTicks = Array.from({ length: 5 }, (_, i) => y0 + ((y1 - y0) * i) / 4);
  const xTicks = Array.from({ length: 6 }, (_, i) => x0 + ((x1 - x0) * i) / 5);
  return (
    <figure className="vol-smile" aria-label="Smile de volatilidad">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" preserveAspectRatio="xMidYMid meet">
        {yTicks.map((t) => <g key={t}><line x1={PAD.l} x2={W - PAD.r} y1={Y(t)} y2={Y(t)} stroke="rgba(255,255,255,.07)" /><text x={PAD.l - 6} y={Y(t) + 4} textAnchor="end" className="vol-axis">{t.toFixed(1)}%</text></g>)}
        {xTicks.map((t) => <text key={t} x={X(t)} y={H - 8} textAnchor="middle" className="vol-axis">{Math.round(t)}</text>)}
        <line x1={X(spot)} x2={X(spot)} y1={PAD.t} y2={H - PAD.b} stroke="rgba(255,255,255,.35)" strokeDasharray="3 4" />
        <text x={X(spot)} y={PAD.t - 4} textAnchor="middle" className="vol-axis">spot {spot.toFixed(0)}</text>
        {series.map((s) => (
          <polyline key={s.e.expiration} fill="none" stroke={s.color} strokeWidth={s.primary ? 2.4 : 1.6} strokeOpacity={s.primary ? 1 : 0.65}
            points={s.pts.map((p) => `${X(p.strike).toFixed(1)},${Y(p.iv).toFixed(1)}`).join(' ')} />
        ))}
      </svg>
      <figcaption>
        {series.map((s) => <span key={s.e.expiration} style={{ color: s.color }}>● {fmtExpiry(s.e.expiration)} · {s.e.dte === 0 ? '0DTE' : `${s.e.dte}d`}</span>)}
      </figcaption>
    </figure>
  );
}
