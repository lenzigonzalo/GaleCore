# Vista práctica del informe de contexto (GC-AI-0010) — borrador de sesión

Plantilla con la que se generó el 28/09/2026 la vista que el usuario aprobó como formato
(https://claude.ai/artifact/G7L8oniVGHvQfFupAQzS8R): 4 números clave, «qué mirar», posiciones y salidas, calendario
posiciones × eventos, SPY contra strikes, tasas y crédito en pb, volatilidad, faltantes.

- `cartera_page.tpl.html`: HTML con `__DATA__` como marcador; los gráficos se dibujan con JS a partir de ese JSON.
  Los números de las tablas y los textos están escritos a mano en esta versión (no salen del registro).
- `viz_data_2026-09-28.json`: series usadas (FRED DGS10/DFII10/T10YIE/BAMLH0A0HYM2, SPY de FMP), extraídas de las
  evidencias `evidence:2026-09-28-cartera-ctx-*`.

Generación usada: reemplazar `__DATA__` por el JSON y envolver `#cal` en un contenedor con scroll horizontal.
**Falta (recorrido C):** que todo el contenido salga del registro y las evidencias por código (template determinista en
el repo, con tests), no a mano. Esto es el punto de partida, no la skill.
