# WS-0036 — resumen compacto

`feature/GC-0036-panel`, commit local sin push. Sólo front.

Un panel con cuatro columnas y filas de nombre/valor del mismo tamaño, separadores finos y cuatro cifras principales arriba. «Qué falta» eliminado; null como «—», motivo sólo en title. Calendario «octubre 2026». Compra verde y venta roja; filas compartidas más horizontales y compactas, entrada corta en ET con fecha completa en title.

`CI=true npm run build`: exit 0. `CI=true npm test -- --watchAll=false --runInBand`: exit 0, 33 suites y 144 tests. `git diff --check`: limpio. Salidas en build.txt y tests.txt.

Dev comprobado por DOM, sin capturas nuevas: cuatro columnas; filas a 1920 px de 104 px de alto, valores en la misma línea. Sin desbordes a 1920, 1366 y 760 px. Lecturas en layout.txt. No se modificaron las capturas anteriores ni se marcó VALIDATED/CLOSED.
