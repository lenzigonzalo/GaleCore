import React from 'react';
import './MonitorOverview.css';
import './MacroPreview.css';

/** TEMPORAL GC-0011: datos visuales locales, sin conexión a un proveedor macro. */
export function MacroPreview() {
  return <main className="macro-page"><header className="macro-page-heading"><h1>Macro</h1><span>Tasas, dólar y volatilidad</span></header><section className="mo-panel mo-macro"><header><h2>Panorama macroeconómico</h2><span>Tasas · dólar · volatilidad</span></header><div className="macro-indicators">{[{label:'US 10Y',value:'4,28%',change:'−4 pb'},{label:'US 2Y',value:'4,06%',change:'−2 pb'},{label:'DXY',value:'103,40',change:'+0,12%'},{label:'VIX',value:'18,42',change:'−0,68'}].map(v => <div key={v.label}><span>{v.label}</span><strong>{v.value}</strong><small>{v.change}</small></div>)}</div><div className="macro-rate"><span>Tasa a 10 años</span><svg viewBox="0 0 700 64" preserveAspectRatio="none" role="img" aria-label="Evolución de tasa a 10 años"><polyline points="0,12 60,8 120,20 180,16 240,30 300,24 360,38 420,34 480,46 540,40 600,52 700,45" stroke="var(--white-line)" strokeWidth="2" fill="none" vectorEffect="non-scaling-stroke"/></svg><span>4,28%</span></div></section></main>;
}
