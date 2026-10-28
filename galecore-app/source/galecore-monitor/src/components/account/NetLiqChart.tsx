import React, { useEffect, useRef } from 'react';
import type { IChartApi, UTCTimestamp } from 'lightweight-charts';

/** Valor de la cuenta en el tiempo (Inicio): área simple, en verde si el período gana y en rojo si pierde. */
export function NetLiqChart({ points, up, label, intraday = false }: { points: { time: string; value: number }[]; up: boolean; label: string; intraday?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current || points.length < 2) return;
    let chart: IChartApi | undefined;
    let alive = true;
    void import('lightweight-charts').then(({ createChart, AreaSeries, ColorType }) => {
      if (!alive || !host.current) return;
      const css = getComputedStyle(host.current);
      const color = (up ? css.getPropertyValue('--green') : css.getPropertyValue('--red-gc')).trim() || (up ? '#34d399' : '#f87171');
      chart = createChart(host.current, { autoSize: true,
        layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: css.getPropertyValue('--text-secondary').trim() || '#b5b5b5', fontSize: 13 },
        grid: { vertLines: { visible: false }, horzLines: { color: '#262626' } },
        // Las horas en la zona del navegador (lightweight-charts dibuja en UTC si no se le dice).
        localization: { timeFormatter: (t: number) => new Date(t * 1000).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) },
        timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false,
          tickMarkFormatter: (t: number) => intraday ? new Date(t * 1000).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
            : new Date(t * 1000).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }).replace('.', '') },
        rightPriceScale: { borderVisible: false },
        handleScroll: false, handleScale: false });
      const series = chart.addSeries(AreaSeries, { lineColor: color, topColor: color + '55', bottomColor: color + '05', lineWidth: 2,
        priceFormat: { type: 'custom', formatter: (v: number) => `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}` } });
      const seen = new Set<number>();
      series.setData(points.map(p => ({ time: Math.floor(new Date(p.time).getTime() / 1000) as UTCTimestamp, value: p.value }))
        .filter(p => !seen.has(p.time) && seen.add(p.time)).sort((a, b) => a.time - b.time));
      chart.timeScale().fitContent();
    });
    return () => { alive = false; chart?.remove(); };
  }, [points, up, intraday]);
  if (points.length < 2) return <div className="rs-chart rs-chart-empty">Sin historia para este período.</div>;
  return <div ref={host} className="rs-chart" role="img" aria-label={label} />;
}
