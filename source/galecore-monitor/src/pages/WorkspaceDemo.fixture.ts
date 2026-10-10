
/** TEMPORAL: datos ficticios para la demo integral. No importar desde stores o APIs. */
export const visualOrders = [
  { id: 'GC-1042', time: '14:31:08', strategy: 'SPY Income', action: 'Cerrar 2 PCS · 600 / 595', type: 'Límite', price: '1.70', state: 'Pendiente de revisión' },
  { id: 'GC-1041', time: '11:08:42', strategy: 'IWM Range', action: 'Abrir 2 CCS · 230 / 235', type: 'Límite', price: '1.25', state: 'Ejecutada' },
  { id: 'GC-1040', time: '10:42:15', strategy: 'QQQ Neutral', action: 'Abrir 1 iron condor', type: 'Límite', price: '3.95', state: 'Ejecutada' },
];
export const visualCalendar = [125,-80,245,310,-125,0,0,180,220,-90,450,165,0,0,-140,280,125,390,-60,0,0,210,-95,320,145,842.8,0,0];
export const visualAgents = [
  { name: 'Supervisor de posiciones', role: 'Vencimientos, stops y objetivos de salida', schedule: 'Cada 5 minutos', last: '14:32', result: 'SPY Income próximo al objetivo', enabled: true },
  { name: 'Contexto macro', role: 'Historia del mercado, evidencia y eventos', schedule: 'L–V · 08:00', last: '08:00', result: 'Inflación y tasas reales en foco', enabled: true },
  { name: 'Explorador de oportunidades', role: 'Candidatos compatibles con el mandato', schedule: 'Cada 30 minutos', last: '14:00', result: '2 candidatos para investigar', enabled: false },
  { name: 'Curador de conocimiento', role: 'Decisiones y aprendizajes del día', schedule: 'L–V · 17:00', last: 'Ayer 17:00', result: '3 decisiones incorporadas', enabled: true },
];
export const visualDocuments = [
  { title: 'Inflación, tasas reales y prima de riesgo', kind: 'Análisis macro', project: 'Contexto de mercado', date: 'Hoy · 08:12', text: 'La caída de las tasas reales acompaña la recuperación de acciones. La tesis depende de que el próximo dato de inflación no vuelva a acelerar. Una explicación alternativa es el ajuste de posicionamiento previo al evento.' },
  { title: 'SPY Income · revisión de salida', kind: 'Decisión', project: 'SPY Income', date: 'Hoy · 14:32', text: 'Revisar el cierre antes del dato. La posición gana $340, vence en dos días y está cerca del objetivo del 55 %. Comparar asegurar el resultado con mantener riesgo de evento.' },
  { title: 'QQQ Neutral · comparación v1 / v2', kind: 'Experimento', project: 'QQQ Neutral', date: 'Ayer · 16:20', text: 'La versión 2 reduce el tamaño y evita nuevas entradas antes de eventos macro. Sigue en SHADOW. La muestra todavía no permite atribuir una mejora a las reglas nuevas.' },
  { title: 'Reglas de asignación y reserva', kind: 'Método', project: 'Cartera', date: '07 oct · 11:05', text: 'Mantener reserva para gestión y revisar apuestas repetidas entre estrategias. La concentración por capital asignado no equivale a exposición direccional.' },
];
