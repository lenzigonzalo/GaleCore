# Revisión independiente — WS-0057 B, Mercado compacto

**Veredicto:** CHANGES_REQUESTED. No cerrar ni marcar VALIDATED.

## Alcance

- Revisión de una sola pasada sobre el working tree local de `feature/WS-0057-mercado-compacto`.
- Base: `HEAD 3ad1e90` (`Registrar reinicio del monitor y verificación de TypeScript`).
- Árbol revisado: cambios sin commit en nueve archivos del monitor y seis archivos nuevos sin seguimiento:
  `ExpiryPicker.tsx`, `ExpiryPicker.test.tsx` y `docs/engineering/evidence/WS-0057-mercado/{README.md,probe_candles.py,candles-real.json,gex-real.json}`.
- Se contrastó con «B, segunda vuelta» de `docs/engineering/work-items/WS-0057-front-con-el-uso.md`.
- No se editó código ni el work item. El único archivo agregado por esta revisión es este informe.
- QA visual pendiente: el inventario CUA estaba vacío y el navegador IAB no estaba disponible. No se usó Playwright ni otra automatización sustitutiva; build y tests no acreditan apariencia, alturas, anchos ni comportamiento visual de los popovers.

## Hallazgos

### [P1] El foco de teclado no revela las referencias de las métricas compactas

`DetailsPanel.tsx:448-455` reemplaza las tarjetas por `span` con `tabIndex={0}` y guarda la referencia únicamente en el atributo `title`. El navegador puede mostrar `title` al mantener el cursor, pero no presenta de forma fiable ese tooltip cuando el elemento recibe foco de teclado; tampoco hay contenido visible condicionado por `:focus`, evento de foco o `aria-describedby`. Por lo tanto, la mitad «referencias disponibles al enfocar/pasar el cursor» queda cumplida sólo para mouse y el README afirma más de lo que implementa.

Impacto: quien navega con teclado llega a cada métrica, pero no puede profundizar desde la interfaz en la referencia/valores crudos solicitados. Corregir con una ayuda visible tanto en hover como en `focus-visible` (o un popover accesible compartido) y una prueba que ejercite foco, no sólo presencia de `title`.

## Riesgo residual y límites comprobados

- El probe real consultó SPY 1h por 30 días: 529 filas en 3,19 s, sin tiempos duplicados y con una OHLC inválida fuera de las últimas 100. La ejecución no reprodujo el aviso original; esa fila no explica el recorrido actual con límite 100. El README lo distingue correctamente de los dos defectos confirmados por código (timeout cliente sin margen frente al snapshot de 30 s y pérdida de líneas al reemplazar la serie). La causa exacta del aviso original sigue sin demostrarse.
- `gex-real.json` registra una respuesta real de SPY en 4,91 s con 17 vencimientos, 362 strikes globales e IV/skew 25Δ en los 17; acredita disponibilidad de datos, no el layout ni la interacción.
- La recarga de velas y la recreación de líneas tras reemplazar la serie se revisaron estáticamente, pero no tienen una prueba focal del componente `GexChart`; el riesgo principal queda en ese ciclo asíncrono.
- La distribución responsive, legibilidad del perfil GEX al comprimirse al 48 %, alto efectivo «sin scroll», superposición/cierre de desplegables y leyenda horizontal del smile requieren el recorrido visual pendiente.

## Verificación ejecutada por esta revisión

- `CI=true npm test -- --runInBand --watchAll=false src/api/marketdata.test.ts src/components/gex/ExpiryPicker.test.tsx src/components/gex/VolSmile.test.tsx src/pages/Gex.test.tsx`: PASS, 4 suites / 11 pruebas. `Gex.test.tsx` emitió avisos de actualizaciones fuera de `act`, sin fallos.
- `CI=true npm run build`: PASS. Único aviso: base de Browserslist desactualizada.
- `git diff --check HEAD`: PASS.

Tras corregir el hallazgo, corresponde al implementer verificarlo; esta revisión independiente no hace recheck. Sigue haciendo falta la aprobación del owner y el QA visual antes de cualquier VALIDATED/CLOSED.
