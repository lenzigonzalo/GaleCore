# Acceso a GaleCore local — verificación (2026-09-26 00:37 UTC, mercado cerrado)

Sólo lectura. Sin levantar ni modificar nada: `DataFeed.Api.exe` ya estaba corriendo (PID 2180).

| Vía | Resultado | Evidencia |
|---|---|---|
| REST `http://127.0.0.1:7001` | Responde; **401** sin header `X-API-KEY` (salvo `/swagger`). No se usó la clave | `swagger.json` (47 operaciones: `/Data/Tastytrade/*`, `/App.Analytics/*`, `/App/Rpf/*`, `/App/Runtime/*`, …) |
| MCP `POST /mcp` (sin clave, bypass declarado en `GaleCore/CLAUDE.md`) | `initialize` 200; `tools/list` → **10 herramientas** de mercado, todas de lectura | `init.*`, `tools_list.body` |
| `get_implied_volatility` SPY | spot 772; IV30 9d 11,77 / 30d 14,81 / 90d 17,57 | `get_implied_volatility.*` |
| `get_iv_rank` SPY | ivRank 12,71 con `tradingDays: 252`, pero `history` trae **10 días** (2026-09-14 → 09-25) y `highIV`/`lowIV` = 0: respuesta internamente inconsistente | `get_iv_rank.*` |
| `get_market_data_by_type` SPY | bid 772 / ask 772,04; `updatedAt` = `0001-01-01`, `dayHighPrice` = 0, `prevClose` = 0 (campos vacíos) | `get_market_data_by_type.*` |

Qué **no** da el MCP: reglas de RPF, specs y evaluaciones del runtime SHADOW, historia de cadenas (sólo
velas de una opción por símbolo), VIX/VIX9D/VVIX como índices (no probado), futuros. Lo que está detrás de
la API key (runtime, reglas) no se probó. El `Mcp-Session-Id` se redactó.
