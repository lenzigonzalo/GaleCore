# Macro M0 — contrato y cobertura v1

13/10/2026 · GC-0030 / WS-0030 · flag `frontend`. Autoridad funcional: spec del workspace;
implementación acotada a M0/M1. No es etapa 1 global completa. Sin llamadas a IA ni al harness.

## Cobertura

| Widget / series | Fuente existente | Frecuencia / unidad | Método | Cobertura / derechos |
|---|---|---|---|---|
| UST2/5/10/30 | TreasuryYieldCurveHandler | diaria publicada / % | curva par nominal, misma fecha para comparación entre plazos | US; muestra real en snapshot-real.json; redistribución pendiente |
| SLOPE2_10 / SLOPE5_30 | mismas observaciones Treasury | diaria / pb | (largo−corto)×100, sólo fechas comunes; null conserva faltante | cálculo versionado long-minus-short-v1 |
| DFII10 | FredSeriesHandler | Daily / % | tasa real de referencia; cambio en pb | US, vintage leído no equivale a vintage solicitado |
| T10YIE | FredSeriesHandler | Daily / % | breakeven, compensación por inflación, no expectativa pura | US; publicación exacta desconocida |
| BAMLH0A0HYM2 / BAMLC0A0CM | FredSeriesHandler | Daily, Close / % | OAS; diferencia ×100 en pb | US; identidad/unidad/frecuencia validadas antes de calcular |
| VIX / VVIX / SKEW | CboeIndexHistoryHandler | diaria / puntos | cierre de índices spot, no futuros | datos originales, cache provider 6h; no IV/skew por strike |
| Próximos eventos | FredReleaseDatesHandler (10/50/46/53) + FomcMeetingsHandler | fecha programada / día | ventana de 45 días, dedup por identificador de fuente/fecha | sin hora exacta, consenso, sorpresa ni atribución causal |
| Política implícita / amplitud / dólar amplio / commodities | no habilitada | N/D | no sustituir por curva par ni ETFs | fuente/método/derechos pendientes |
| Regiones distintas de US / Local→USD | no habilitada | N/D | sin FX/cortes compatibles no convertir | M3; Global muestra sólo cobertura disponible |
| Magnitud / noticia / interpretación / GEX-DEX | no habilitada | N/D | sin método/muestra/feed/inputs no generar | M2–M5 |

Acceso puntual real no acredita licencia ni precisión sostenida. No se dieron de alta fuentes.
Fuentes FRED: links públicos por serie; Treasury/CBOE/Fed: URL original sanitizada. Ninguna API key en referencias.

## Rutas y datos

`GET /App/Macro/Catalog`, `/Snapshot?horizon=month&region=Global&currency=Local`,
`/Snapshots/{id}`, `/Series/{id}?snapshotId={id}`, `/Events?snapshotId={id}`.
Usan el control de acceso existente de la API; no endpoints de órdenes/cuenta/IA.
Catálogo, observaciones, métricas, eventos y estados están definidos en `MacroContracts.cs`.
IDs de observación: serie:fecha. IDs de eventos: fuente:release:fecha o fed:fecha.
Snapshot ID/hash: SHA-256 del alcance, corte, observaciones, métricas, eventos y estados serializados por .NET.
Schema 1.0, macro-v1, difference-v1; pendientes citan las dos observaciones en qualityReasons.
El método de diferencia en pb es el mismo para cambios de tasa y OAS; en pendientes/índices usa puntos de su unidad.

Horizontes: `month` ancla al aniversario mensual del último dato válido, última observación en o antes de ese día,
tolerancia de 7 días, con actualFrom/actualTo explícitos. No equivale a 20 observaciones.
`session`, `five-sessions`, `event` conservan niveles pero devuelven cambio N/D con motivo hasta verificar
calendario/evento. No se infieren feriados, DST ni medias sesiones. No hay retornos de precio aún.
Null no se transforma en cero ni se imputa. Cruces de fechas para pendientes sólo por intersección.
Retraso: más de 7 días calendario respecto del corte, regla conservadora explícita para las series diarias de M1;
no es detector de mercado abierto/cerrado. No se declara mercado cerrado sin calendario verificado.

Publicado/availableAt desconocidos quedan null; timestampPrecision=day. RetrievedAt es consulta, nunca publicación.
DataCutoff limita fechas de observaciones al día de la solicitud; **no prueba qué era conocido a esa hora**.
historicalFidelity=revised-history-only. Toda consulta con cutoff manual se rechaza 400, también USD y regiones
no soportadas. Snapshot guardado recupera esa lectura original; no reconstruye un vintage histórico.

Cada fuente tiene límite de 12s, await cancelable y estado independiente. Error conserva última parte válida
en cache de proceso de diez claves con sus fechas originales y source-error; no usa fixtures. El cache se pierde
al reiniciar. Enlace a snapshot inmutable conserva evidencia más allá del cache. Empty es unavailable, no «sin cambios».
Todo número abre unidad, fecha, consulta, fórmula y referencia. Eventos conservan límites por fuente.

## Persistencia y preview

Opt-in `Macro__SnapshotDirectory`: archivos locales content-addressed, creación atómica, no sobreescritura;
2 MiB por payload, 100 snapshots, sin borrado/retención temporal automática. Al alcanzar límite: 507 y explicación.
Sin configuración: 503 en todas las lecturas; ID/referencia inexistente con store configurado: 404.
No migraciones ni cambios de base. Directorio ignorado `dev/.local/macro-snapshots` en el worktree aislado.
Privacidad: datos públicos de mercado, no cartera ni credenciales. No publicar el directorio de user-secrets.

`python dev/macro_dev.py api|monitor`: worktree obligatorio, Dev validado, API 7002 / monitor 5173,
sin tocar los procesos 7001/3039 de Claude. Overrides ignorados de RPF/GEX/skew/runtime sólo en este worktree;
persistencia de runtime deshabilitada. Config Dev original sólo se lee; no se cambian secretos ni producción.
Para integrar la nueva API en el Dev habitual se necesita el próximo reinicio coordinado; esta sesión conserva
los procesos de Claude y entrega el recorrido desde la preview aislada.
