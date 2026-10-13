---
id: D-0002
title: MCP de brokers o API de GaleCore — se decide por de quién es el dato
date: 2026-10-13
status: vigente
scope: galecore-ai
---
**Contexto.** Hay MCP de brokers en el host (IOL conectado, IBKR por autenticar, tastytrade tiene MCP propio sin
conectar) y la duda vuelve: ¿lo liviano por MCP y lo complejo por GaleCore, suponiendo que GaleCore es más caro?
GaleCore ya lee tastytrade por API/DXLink para mercado y expone su propio MCP (`DataFeed.Api/Infrastructure/McpTools.cs`).

**Decisión (owner, 13/10).** El canal no se elige por si la consulta es liviana o pesada, sino por de quién es el dato:

| Dato | Canal | Por qué |
|---|---|---|
| Mercado y cálculos (precios, griegas, GEX, vol, macro) | GaleCore | Devuelve el resultado ya calculado y compacto, es local y es una sola fuente; el MCP devuelve crudo (más tokens) y el modelo calcularía |
| Cuenta real de cada broker (posiciones, saldos, órdenes) mientras GaleCore no la tenga | MCP del broker, **sólo lectura** | Es lo único que GaleCore no tiene todavía |
| Validación rápida de un número | MCP, avisando | Rol de benchmark (IBKR) |
| Lo de la cuenta que se usa seguido o que necesitan riesgo o runtime | GaleCore lo incorpora (adapter) | Lo que se repite vive en GaleCore |

GaleCore **no es** el canal caro: en tokens cuesta más traer datos crudos por MCP y calcular en el modelo.

**Límites.** Ninguna orden sale del chat por MCP, aunque el broker exponga tools que escriben (IOL `place_order`,
etc.); ejecutar es PAPER/LIVE (U-62), por GaleCore. Lo leído de una cuenta real es real y no entra en SHADOW
(`PRODUCT.md` «Límites»).

**Consecuencias.** Resuelve la parte de routing de las propuestas de `BL-006` (addendum 13/10). El portfolio
consolidado (U-36, U-61, `BL-008`) arranca por tastytrade dentro de GaleCore, que ya conecta; el bloqueo conocido es
`BL-015` (403 `not_permitted` en cuenta). El bloqueo técnico de escrituras en el host sigue sin elegir.
