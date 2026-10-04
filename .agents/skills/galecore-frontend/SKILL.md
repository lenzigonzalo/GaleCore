---
name: galecore-frontend
description: Crear o modificar pantallas, componentes, estilos y gráficos del monitor de GaleCore manteniendo su tema carbón, tipografía y jerarquía de lectura. Usar para cualquier cambio visual en galecore-monitor; no para backend ni otros productos.
---

# Frontend de GaleCore

Aplicar la dirección visual elegida por el owner: dashboard negro y carbón, texto claro,
tarjetas suaves y números importantes que se distinguen de sus etiquetas. El pedido explícito
del usuario prevalece si cambia esta dirección. Esta skill guía presentación, no autoriza
funcionalidades, operaciones financieras ni despliegues.

## Fuente de verdad

Leer los archivos existentes antes de diseñar. Las rutas siguientes son relativas a esta skill:

- [index.css](../../../source/galecore-monitor/src/index.css): variables de superficies,
  bordes, texto, acentos, estados, fuentes y foco visible.
- [tailwind.config.js](../../../source/galecore-monitor/tailwind.config.js): escala tipográfica
  compartida y colores Tailwind enlazados a las variables CSS.
- [SectionTitle](../../../source/galecore-monitor/src/components/common/SectionTitle.tsx),
  [TickerCard](../../../source/galecore-monitor/src/components/ticker/TickerCard.tsx),
  [AccountSummary](../../../source/galecore-monitor/src/components/account/AccountSummary.tsx)
  y [DetailsPanel](../../../source/galecore-monitor/src/components/gex/DetailsPanel.tsx):
  patrones existentes para títulos, precios, balances y contexto numérico. Leer el que corresponda.

No copiar la paleta en otro documento o archivo de configuración. Una modificación global
se hace en los tokens compartidos; los componentes usan sus variables y clases existentes.

## Tema y jerarquía

- Usar superficies `--bg-primary`, `--bg-secondary`, `--bg-tertiary` y sus variantes para
  distinguir fondo y tarjetas. Bordes discretos; tarjetas principales con radios de 12–14 px.
- Usar `--font-sans` (DM Sans con fallback local) para interfaz y texto; JetBrains Mono o
  `.font-mono` para valores técnicos. Los números comparables usan `.tabular-nums`.
- Priorizar clases de la escala compartida. Referencia de lectura: texto general 14–16 px,
  etiquetas secundarias 12–14 px, títulos de pantalla 24 px, métricas principales 20–24 px,
  balances destacados 28 px y precios de tarjetas 30 px. Adaptar según el rol del dato;
  no agrandar todo por igual ni volver al texto general de 9–11 px para hacer espacio.
- Separar nombre, valor y referencia. Un valor importante recibe mayor tamaño y peso;
  su unidad, frescura y contexto permanecen visibles. Dar aire y permitir que crezca la tarjeta.
- Selección principal de navegación: superficie clara y texto oscuro. Acciones destacadas
  pueden usar `--accent` con `--accent-ink`. Conservar foco de teclado visible.

## Colores con significado

El tamaño y el color no cambian lo que significa un dato. Preservar condiciones de ganancias,
pérdidas, riesgo, falta de datos y estado de conexión. Usar sus tokens semánticos; un acento
decorativo no reemplaza esos estados ni convierte una pantalla informativa en un veredicto.
CALL/PUT se toman de [optionSideColors.ts](../../../source/galecore-monitor/src/utils/optionSideColors.ts).
Mantener etiquetas y unidades: color solo no alcanza para explicar una métrica.

En gráficos canvas, resolver las variables con `getComputedStyle` antes de pasarlas a la API;
canvas no interpreta cadenas `var(...)` como valores de fuente o color. Conservar escalas,
coordenadas e identidad de series al ajustar la presentación.

## Espacio y comprobación

Permitir envolver texto, filas de cotización y grupos de métricas cuando el tamaño aumentado
lo necesita. Evitar recortar valores importantes con ellipsis. Los grupos GEX conservan orden,
pregunta y proporción según cantidad de métricas; pueden pasar a otra línea.
No aplicar overflow de recorte al ancestro de menús emergentes: el menú de cuenta sale del nav.
Revisar alturas fijas, columnas estrechas e importes largos al cambiar fuentes.

Para un cambio de frontend ejecutar `CI=true npm run build` en `source/galecore-monitor`
y `git diff --check` en GaleCore, siguiendo el loop de ENGINEERING.md. Cuando haya navegador
disponible, observar las pantallas afectadas con datos existentes y comprobar legibilidad,
envoltura y menús. Si falta acceso, declarar QA visual pendiente; el build no prueba apariencia.
Un cambio solo de esta guía requiere validar la skill, no recompilar el front.
