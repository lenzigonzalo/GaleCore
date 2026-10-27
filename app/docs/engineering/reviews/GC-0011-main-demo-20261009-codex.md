# GC-0011 — revisión independiente de demo temporal Main

09/10/2026. Reviewer separado review_main_demo, gpt-5.6-sol, esfuerzo alto. Una pasada, sólo lectura de diff sobre ea541d1 y cuatro archivos nuevos MainDemo.*.

Dictamen: APPROVE para demo temporal. 0 BLOCKER, 0 MAJOR, 1 MINOR.

MINOR: inspección de puntos del gráfico sólo mediante mouse, sin acceso por teclado/táctil. No bloquea prototipo: períodos tienen botones accesibles y curva descripción explícita. Pendiente de diseño final.

Aislamiento: activación inicial sólo loopback con ?main=demo; fixtures separados/rotulados; MainDemo sin APIs/stores; interacción local y salida a cuenta real. Saldo/conexión/buscador reales ocultos sólo en demo. Sin ejecución, mutaciones externas ni envío de prompts.

Períodos recalculan serie y limpian punto seleccionado. Layout usa min-height:0/overflow:auto, apila en anchos menores y permite scroll de tablas; en escritorios bajos hay scroll interno. QA visual, alturas percibidas y navegación real pendientes porque no hubo navegador.

Evidencia recibida: build Dev CI verde main.2d748727.js; 9 tests/3 suites. git diff --check sin errores; archivos nuevos sin whitespace defectuoso/marcadores. No hubo edición ni recheck del reviewer.

APPROVE cubre sólo recorte temporal, no cierra GC-0011. Retirada obligatoria de fixtures, componentes, estilos y flags antes de Main final.
