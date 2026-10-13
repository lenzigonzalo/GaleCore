import React, { useEffect, useRef } from 'react';
import type { IChartApi, Time } from 'lightweight-charts';
import type { MacroObservation } from '../../types/macroTypes';

export function MacroChart({ rows, unit, label }: { rows: MacroObservation[]; unit: string; label: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current || !rows.some(r => r.value !== null)) return;
    let chart: IChartApi | undefined;
    let alive = true;
    void import('lightweight-charts').then(({ createChart, LineSeries, ColorType }) => {
    if (!alive || !host.current) return;
    const css = getComputedStyle(host.current);
    chart = createChart(host.current, { autoSize: true, height: 180,
      layout: { background: { type: ColorType.Solid, color: css.getPropertyValue('--bg-secondary').trim() || '#191919' },
        textColor: css.getPropertyValue('--text-secondary').trim() || '#b5b5b5', fontSize: 12 },
      grid: { vertLines: { visible: false }, horzLines: { color: '#303030' } },
      timeScale: { borderVisible: false }, rightPriceScale: { borderVisible: false } });
    const series = chart.addSeries(LineSeries, { color: css.getPropertyValue('--accent').trim() || '#c7d2cb', lineWidth: 2,
      priceFormat: { type: 'custom', formatter: (v: number) => `${v.toFixed(2)} ${unit}` } });
    series.setData(rows.map(r => r.value === null ? { time: r.observationTime as Time } : { time: r.observationTime as Time, value: r.value }));
    chart.timeScale().fitContent();
    });
    return () => { alive = false; chart?.remove(); };
  }, [rows, unit]);
  return <div ref={host} className="macro-chart" role="img" aria-label={label} />;
}
