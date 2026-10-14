# Ajuste de tipografía y encabezados

SHADOW y las filas compartidas usan las mismas fuentes y fallbacks de la plataforma: `--font-sans` y `--font-mono`, definidos en index.css. La tabla ya no aplica monoespaciado a textos de estado, operaciones o salidas. El gráfico usa la fuente de interfaz compartida.

Columna «% Gan», definición completa en title. Encabezados de tabla centrados horizontal y verticalmente. Dev comprobado por DOM a 1366 y 1920 px: texto de la columna en una línea y dentro de su ancho, encabezados centrados, fuentes de lista y detalle coincidentes. Sin capturas nuevas.

`CI=true npm run build` exit 0; `CI=true npm test -- --watchAll=false --runInBand` exit 0: 33 suites / 144 tests. Salidas en fonts-build.txt, fonts-tests.txt y fonts-layout.txt. Commit local en feature/GC-0036-panel, sin push ni cambio de estado del work item.
