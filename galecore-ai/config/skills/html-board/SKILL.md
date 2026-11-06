---
name: html-board
version: 1.0.0
display_name: Tablero HTML
description: >
  Arma un tablero, panel o informe visual como un único `.html` autocontenido en el proyecto, con datos de GaleCore
  embebidos y su fecha a la vista, y se abre renderizado a la derecha del chat. Sólo lectura. Una consulta puntual
  sigue en el chat con una tabla.
output_contract: galecore_ai.contracts.research.ResearchContent
---
## Cuándo se usa
«Armame un tablero de SPY», «un panel con mi cartera», «un informe visual de la macro», «haceme un gráfico de la
curva de tasas». El trader pide algo para mirar, no una respuesta. Una consulta puntual (un precio, un dato, una
comparación corta) se contesta en el chat con una tabla.

## Qué necesita
- Los datos, sólo de GaleCore: `galecore get <capacidad> --out .scratch/<tema>-<dato>.json --keep "<pedido>"`.
- Si ya hay un tablero del tema en `files/`, se lee y se actualiza ese mismo archivo.

## Pasos
1. Juntar los datos con `galecore get`, una vez por bloque, y anotar fuente y fecha/hora de cada uno. Lo que falta se
   dice en el tablero; no se inventa ni se rellena.
2. Escribir un único `files/<tema>.html` autocontenido: CSS y JS adentro, datos embebidos como JSON al momento de
   armarlo. Librerías sólo de `cdnjs.cloudflare.com` o `cdn.jsdelivr.net` (Chart.js; Lightweight Charts para velas).
   Sin `fetch` a APIs, sin claves, sin datos de otro usuario. El HTML está aislado y no puede pedir datos en vivo:
   para actualizarlo se vuelve a armar.
3. Diseño:
   - Arriba, los números clave grandes (tarjetas KPI); después gráficos y tablas. Una idea por bloque.
   - Fecha y hora de los datos a la vista arriba y la fuente de cada bloque.
   - Positivos en verde, negativos en rojo. Sin textitos grises ni etiquetas tipo «generado por IA».
   - Formatos unificados: fechas `dd/mm hh:mm` (con ET si aplica), precios con 2 decimales, porcentajes con signo.
   - Tabla o gráfico sólo cuando se entiende mejor que el texto. Ejes con unidades; leyenda sólo si hay más de una
     serie; títulos en lenguaje del trader.
   - Colores como variables CSS en `:root`, modo oscuro con `prefers-color-scheme`, fondo explícito en `body`.
   - Ancho fluido: tiene que andar en el panel lateral (~500 px) y a pantalla completa, sin scroll horizontal.
4. Enlazar `[<título>](files/<tema>.html)` y decir «guardé» sólo después de escribir el archivo.

## Errores a evitar
- Pedir datos en vivo desde el HTML o meter claves.
- Repetir el tablero en texto en el chat.
- Rellenar un dato que falta con una estimación sin decirlo.
- Armar un tablero cuando el trader hizo una consulta puntual.

## Cómo responder
Una línea con qué muestra el tablero y el enlace. No repetir su contenido en texto.
