import React from 'react';
import type { MacroBoard } from '../../api/macroData';

/** Curva del Tesoro por plazo, armada en la API. */
export function MacroCurve({ curve }: { curve: MacroBoard['curve'] }) {
  if (!curve) return <section className="macro-curve"><h2>Curva del Tesoro</h2><p>Sin fecha común con los cuatro plazos.</p></section>;
  const values = curve.points.map(p => p.value);
  const min = Math.min(...values) - .1, max = Math.max(...values) + .1;
  const x = [30, 110, 200, 290];
  const y = values.map(v => 120 - (v - min) / (max - min) * 90);
  return <section className="macro-curve"><h2>Curva del Tesoro</h2>
    <svg viewBox="0 0 320 160" role="img" aria-label={`Curva ${curve.date}: ${curve.points.map(p => `${p.tenor} ${p.value}%`).join(', ')}`}>
      <polyline points={x.map((v, i) => `${v},${y[i]}`).join(' ')} fill="none" stroke="var(--accent)" strokeWidth="2" />
      {curve.points.map((p, i) => <g key={p.tenor}><circle cx={x[i]} cy={y[i]} r="3.5" fill="var(--accent)" />
        <text x={x[i]} y={y[i] - 10} textAnchor="middle" fill="currentColor" fontSize="14">{p.value.toFixed(2)}</text>
        <text x={x[i]} y="152" textAnchor="middle" fill="currentColor" fontSize="13">{p.tenor.replace(' años', 'a')}</text></g>)}
    </svg></section>;
}
