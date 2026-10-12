/** TEMPORAL GC-0011. Catálogo ilustrativo: no es un inventario del harness. */
type DemoSkill = { id:string; name:string; description:string; category:string; enabled:boolean; files:Record<string,string> };
export const settingsSkills: DemoSkill[] = [
  { id:'strategy_design', name:'Diseño de estrategia', description:'De la hipótesis a reglas claras, supuestos y un plan de validación.', category:'Estrategias', enabled:true,
    files:{'SKILL.md':'# Diseño de estrategia\n\nConvertir una idea en una hipótesis comprobable antes de definir reglas.\n\n## Recorrido\n- Definir el activo y el horizonte.\n- Explicitar la fuente de ventaja esperada.\n- Documentar condiciones de entrada, salida y riesgo.\n- Contrastar la hipótesis con datos y casos adversos.\n\n## Resultado\nUna especificación con supuestos, evidencia y preguntas abiertas.',
    'references/checklist.md':'# Checklist de diseño\n\n- Objetivo y universo de activos.\n- Datos disponibles y limitaciones.\n- Reglas de entrada y salida.\n- Riesgo por posición y por cartera.\n- Evidencia necesaria antes de avanzar.'}},
  { id:'performance', name:'Análisis de resultados', description:'Leer rendimiento, pérdidas y consistencia sin perder el contexto de la muestra.', category:'Análisis', enabled:true,
    files:{'SKILL.md':'# Análisis de resultados\n\nSeparar resultados realizados, posiciones abiertas y flujos de capital.\n\n## Lectura\n- Comparar períodos consistentes.\n- Identificar tamaño de muestra.\n- Analizar drawdown y distribución de resultados.\n- Registrar limitaciones y próximos contrastes.',
    'references/metrics.md':'# Métricas\n\nEl retorno requiere una base y un período explícitos. El P&L abierto se mantiene separado del realizado.'}},
  { id:'research', name:'Investigación de mercado', description:'Ordenar fuentes, contrastar explicaciones y guardar evidencia en el proyecto.', category:'Investigación', enabled:true,
    files:{'SKILL.md':'# Investigación de mercado\n\nResponder una pregunta concreta con evidencia trazable.\n\n## Método\n- Delimitar la pregunta.\n- Contrastar fuentes primarias.\n- Separar hechos, inferencias y escenarios.\n- Guardar conclusión, fecha y limitaciones.'}},
  { id:'risk', name:'Revisión de riesgo', description:'Revisar concentración, vencimientos y escenarios adversos de una cartera.', category:'Riesgo', enabled:false,
    files:{'SKILL.md':'# Revisión de riesgo\n\nLeer posiciones y límites del proyecto antes de proponer un cambio.\n\n- Revisar estructuras y vencimientos.\n- Identificar concentración y eventos.\n- Explicitar escenarios adversos y límites.'}},
];
export const settingsConnections = [
  {name:'Tastytrade', initials:'tt', description:'Cuenta, posiciones y órdenes del broker.', category:'Broker', status:'Conectado · ejemplo'},
  {name:'Datos de mercado', initials:'Dx', description:'Cotizaciones y cadenas de opciones.', category:'Mercado', status:'Conectado · ejemplo'},
  {name:'FRED', initials:'Fr', description:'Series económicas y tasas de interés.', category:'Economía', status:'Disponible'},
  {name:'Biblioteca local', initials:'Gc', description:'Análisis y documentos compartidos.', category:'Workspace', status:'Conectado · ejemplo'},
];
