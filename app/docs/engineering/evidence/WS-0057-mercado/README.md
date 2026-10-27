# Mercado compacto — WS-0057 B, segunda vuelta

Pedido del owner del 23/10/2026. Cambio local en `feature/WS-0057-mercado-compacto`.

## Antecedentes comprobados

- Workspace `WS-0038`: cerrado por el owner el 16/10 con AC-4/5/6 de Mercado pendientes.
- Workspace `WS-0057`, B: registra implementación el 22/10, commit GaleCore `7847a65`.
  Zoom/reset, muros punteados, comparación de vencimientos y smile/skew. Skew sin comprobar en vivo.
- `ACTIVE_WORK_ITEM` sigue apuntando a WS-0055 (agentes). WS-0057 está IN_PROGRESS;
  no se encontró otra pieza futura específica de Mercado que resolviera esta distribución.
  Esto acredita el registro de trabajo; no acredita que haya otro proceso trabajando ahora.

## Cambios

- Contexto compacto sobre los gráficos, referencias mediante foco/cursor.
- Vencimientos en desplegable compartido por Gamma e IV: todos, sólo elegido,
  casillas y rango numérico DTE sobre la cadena disponible.
- El elegido conserva sus barras; las casillas comparan muros/smiles, como antes.
  El agregado global sigue siendo el calculado por la API. No se calcula un GEX de rango en el front.
- Detalle del vencimiento en otro desplegable; gráficos flexibles con alto restante.
- Perfil GEX más ancho, barras de altura adaptativa y muros más tenues.
- Smile adapta sus ejes al espacio disponible.
- Histórico: margen de timeout 45 s frente a los 30 s del snapshot del backend;
  OHLC válido y tiempos únicos; error con motivo y reintento.
- Al reemplazar la serie inicial por velas se recrean los muros en la serie nueva;
  al desmontar se limpian los refs para React StrictMode.

## Ejecutado

- `CI=true npm test -- --watchAll=false --runInBand`: exit 0, **51 suites, 228 pruebas**, corrida final tras la corrección del review.
  Hay avisos `act` de pruebas del monitor; no son fallos.
- `CI=true npm run build`: exit 0. Aviso de Browserslist desactualizado.
- `git diff --check`: exit 0.
- `python GaleCore/docs/engineering/evidence/WS-0057-mercado/probe_candles.py`: exit 0.
  Salida real sanitizada: `candles-real.json` (consulta a Dev; SPY, 1h, últimos 30 días).
  529 velas, sin tiempos repetidos, una OHLC inválida fuera de las últimas 100.
  La API respondió bien durante estas consultas; **no se reprodujo el error original**.
- Consulta real `GET /App/Gex/Analysis?Symbol=SPY&Refresh=false` contra :7001: respuesta
  en 4,91 s, 17 vencimientos, 362 strikes globales, IV por strike y skew25 en los 17.
  Resumen sanitizado en `gex-real.json`. Acredita los datos servidos, no su apariencia en el monitor.

## Evaluado y pendiente

La distribución anterior desperdiciaba espacio por la columna fija de 230 px, el límite de alto
del gráfico y los tiles grandes. Los defectos del timeout y del cambio de serie se verificaron
en código. La vela inválida encontrada no explica el error original de las últimas 100 velas.
No se presenta ninguna de estas observaciones como causa demostrada de ese fallo original.

QA visual/recorrido pendiente: `cua.getState()` devolvió navegadores vacíos y
`cua.createBrowserTab('iab', 'http://localhost:3039')` respondió `Browser is not available: iab`.
No se sustituyó esta comprobación por un E2E inventado. API y monitor sí escuchaban en :7001/:3039.
Sin VALIDATED/CLOSED ni aprobación del owner. Sin push ni PR de GaleCore.

Revisión independiente de una pasada: `docs/engineering/reviews/WS-0057-mercado-compacto-codex.md`,
CHANGES_REQUESTED por referencias que usaban sólo `title`. Corregido por el implementer:
ayuda visible con mouse/foco, `aria-describedby`, y `DetailsPanelCompact.test.tsx` ejercita foco,
desenfoque y hover. Prueba focal 1/1 y suite final 228/228 PASS; build CI final PASS.
No hubo recheck independiente ni se modificó el informe del reviewer.
