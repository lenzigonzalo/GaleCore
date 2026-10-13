import React from 'react';
import type { MacroObservation } from '../../types/macroTypes';

export function MacroCurve({ observations }: { observations: MacroObservation[] }) {
  const tenors = ['UST2', 'UST5', 'UST10', 'UST30'];
  const dates = Array.from(new Set(observations.filter(o => tenors.includes(o.seriesId)).map(o => o.observationTime))).sort().reverse();
  const date = dates.find(d => tenors.every(id => observations.some(o => o.seriesId === id && o.observationTime === d && o.value !== null)));
  if (!date) return <p className="macro-attention">Curva N/D: sin fecha común con cuatro plazos válidos.</p>;
  const values = tenors.map(id => observations.find(o => o.seriesId === id && o.observationTime === date)!.value!);
  const min = Math.min(...values) - .1; const max = Math.max(...values) + .1;
  const x = [55, 180, 340, 600]; const y = values.map(v => 160 - (v - min) / (max - min) * 120);
  return <section className="macro-curve"><div><h2>Curva del Tesoro</h2><p className="macro-curve-date">Rendimiento por plazo · %</p></div>
    <svg viewBox="0 0 660 205" role="img" aria-label={`Curva par ${date}: ${values.map((v, i) => `${tenors[i]} ${v}%`).join(', ')}`} >
      <line x1="40" x2="625" y1="180" y2="180" stroke="currentColor" opacity=".2" />
      <polyline points={x.map((v, i) => `${v},${y[i]}`).join(' ')} fill="none" stroke="var(--accent)" strokeWidth="2" />
      {values.map((value, i) => <g key={tenors[i]}><circle cx={x[i]} cy={y[i]} r="4" fill="var(--accent)" />
        <text x={x[i]} y={y[i] - 12} textAnchor="middle" fill="currentColor" fontSize="22">{value.toFixed(2)}%</text>
        <text x={x[i]} y="200" textAnchor="middle" fill="currentColor" fontSize="22">{[2, 5, 10, 30][i]} años</text></g>)}
    </svg></section>;
}
