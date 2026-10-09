/** TEMPORAL: ficción autorizada para revisar UX. Retirar según GC-0011, sección Demo visual. */
export const demoAccount = { netLiq: 128450.8, cash: 26340, buyingPower: 48620, dailyPnl: 842.8, realizedToday: 567.8, openPnl: 275 };
export const demoWatchlist = [
  { symbol: 'SPY', price: 620.45, change: 0.84, context: 'GEX positivo' },
  { symbol: 'QQQ', price: 552.3, change: -0.41, context: 'GEX negativo' },
  { symbol: 'IWM', price: 220.18, change: 0.23, context: 'Zona neutral' },
  { symbol: 'AAPL', price: 214.62, change: 1.12, context: 'Evento de ejemplo' },
  { symbol: 'TLT', price: 89.34, change: -0.32, context: 'Tasas' },
];
export const demoPositions = [
  { symbol: 'SPY', structure: 'Put credit spread', legs: '600 / 595 · PUT', dte: 2, quantity: 2, value: 0.85, pnl: 340, note: 'Revisar vencimiento cercano y plan de salida.' },
  { symbol: 'QQQ', structure: 'Iron condor', legs: '525 / 530 PUT · 570 / 575 CALL', dte: 16, quantity: 1, value: 2.1, pnl: -185, note: 'Contrastar movimiento del subyacente y exposición de la posición.' },
  { symbol: 'IWM', structure: 'Call credit spread', legs: '230 / 235 · CALL', dte: 23, quantity: 2, value: 0.65, pnl: 120, note: 'Revisar valuación y condiciones del plan antes de decidir.' },
];
export const demoAlerts = [
  { symbol: 'SPY', label: 'Vencimiento cercano', detail: 'El spread vence en 2 días. Revisar el plan.', time: '14:32 ET', tone: 'warning' },
  { symbol: 'QQQ', label: 'Concentración para revisar', detail: '31% de la exposición del escenario está en QQQ.', time: '14:20 ET', tone: 'neutral' },
  { symbol: 'SPY', label: 'Evento de ejemplo', detail: 'Un dato macro ficticio cruza el vencimiento.', time: '13:55 ET', tone: 'neutral' },
];
export const demoEquity = [121200,121420,121080,121850,122180,122040,122610,122380,122900,123060,122640,122850,123520,123110,123760,123920,123420,124160,124440,124200,124860,124550,124880,125240,125050,125630,125310,125980,126110,125720,126300,126620,126050,126480,126930,126720,127110,126850,127300,127520,126940,127260,127810,127480,127060,127620,127890,127430,127710,127970,127540,127880,128160,127950,128340,128060,128470,128210,127608,128450.8];
