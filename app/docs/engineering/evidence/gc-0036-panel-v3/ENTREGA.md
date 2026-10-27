# WS-0036 — front v3

Rama `feature/GC-0036-panel`; integración `d5f6b21`, implementación local `40cc6ff`. Sin push.

Lista con Summary y Status en paralelo, conservada al volver. Resumen compacto, Operaciones con log completo y CSV/JSON sin cálculos, Diseño del proyecto por strategyName y carga al abrir. Null con motivo en title y «Qué falta» plegado. ET y rueda del gráfico preservados. Sin cambios de back ni navegación.

Validación: `CI=true npm run build` exit 0; `CI=true npm test -- --watchAll=false --runInBand` exit 0: 32 suites, 133 tests. Salidas en build.txt/tests.txt. Dev :3039 contra :7001: capturas [lista](list-dev.png) y [Resumen](summary-dev.png), respuestas reales guardadas; 2 cerradas y 4 abiertas de spy_prima_varianza_30_45d. Un Summary y un Panel, sin repetir Summary al volver.

La revisión independiente no terminó: el agente recibió un error de límite de uso. Queda pendiente revisión y aceptación del owner; no VALIDATED/CLOSED. No se comprobó el diseño en Dev: su carga y asociación están cubiertas por tests.
