import React, { useEffect, useRef } from 'react';
import type { IChartApi, Time } from 'lightweight-charts';

/** Gráfico de línea de una serie diaria (fecha, valor). */
export function MacroChart({ points, unit, label }: { points: { date: string; value: number }[]; unit: string; label: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current || points.length === 0) return;
    let chart: IChartApi | undefined;
    let alive = true;
    void import('lightweight-charts').then(({ createChart, LineSeries, ColorType }) => {
      if (!alive || !host.current) return;
      const css = getComputedStyle(host.current);
      chart = createChart(host.current, { autoSize: true, height: host.current.clientHeight || 290,
        layout: { background: { type: ColorType.Solid, color: css.getPropertyValue('--bg-primary').trim() || '#0a0a0a' },
          textColor: css.getPropertyValue('--text-secondary').trim() || '#b5b5b5', fontSize: 14 },
        grid: { vertLines: { visible: false }, horzLines: { color: '#262626' } },
        timeScale: { borderVisible: false }, rightPriceScale: { borderVisible: false } });
      const series = chart.addSeries(LineSeries, { color: css.getPropertyValue('--accent').trim() || '#c7d2cb', lineWidth: 2,
        priceFormat: { type: 'custom', formatter: (v: number) => `${v.toLocaleString('es-AR', { maximumFractionDigits: v < 1 ? 5 : 2 })}${unit ? ` ${unit}` : ''}` } });
      series.setData(points.map(p => ({ time: p.date as Time, value: p.value })));
      chart.timeScale().fitContent();
    });
    return () => { alive = false; chart?.remove(); };
  }, [points, unit]);
  return <div ref={host} className="macro-chart" role="img" aria-label={label} />;
}
