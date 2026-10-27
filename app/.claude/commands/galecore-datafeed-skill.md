---
description: >
  Skill para interactuar con la API DataFeed de GaleCore. Usar cuando se mencione DataFeed,
  market data, cotizaciones, option chains, Greeks, quotes, candles, trades, GEX, gamma exposure,
  MCP server, o se necesite consumir datos de Tastytrade/DXLink. También activar al crear o
  modificar endpoints, handlers, providers, MCP tools, o cualquier componente del repo DataFeed.
  Incluye referencia de arquitectura C#/.NET 8, patrón MediatR CQRS, servidor MCP integrado y
  formato de símbolos OCC de Tastytrade.
---

# DataFeed API — Referencia completa

DataFeed es una **ASP.NET Core Web API (.NET 8)** que consume la API REST de Tastytrade y el feed
WebSocket DXLink para servir datos de opciones y equities. Es el proveedor único de datos que
alimenta el motor de señales y el dashboard Monitor de GaleCore. Incluye un **servidor MCP**
integrado para interacción directa con Claude Code.

---

## Hosting y URLs

| Entorno     | Base URL                                                                             |
|-------------|--------------------------------------------------------------------------------------|
| Local       | `http://localhost:7001`                                                              |
| Producción  | `https://datafeed-g5b4dkfccda5hkdh.chilecentral-01.azurewebsites.net`              |

- Swagger: `/swagger` (sin API Key, sólo en Development)
- MCP: `/mcp` (con `X-API-KEY` o JWT, como el resto)
- Header requerido en todos los demás endpoints: `X-API-KEY: {clave}`

---

## Arquitectura (Clean Architecture — 3 capas)

```
DataFeed.Api           → Controllers, middleware, Swagger, MCP Server. Host ASP.NET Core (minimal hosting).
DataFeed.Application   → Handlers MediatR (CQRS), AutoMapper, funciones Black-Scholes, helpers, GEX calculator.
DataFeed.Infrastructure → Providers externos: TastytradeApiProvider (REST), TastytradeSocketProvider (WebSocket/DXLink), FRED.
```

### Flujo de un request

```
HTTP Request → Controller → DataFeedControllerBase.Handle() → mediator.Send()
             → MediatR Handler (Application) → Infrastructure Provider (REST o WebSocket)
             → AutoMapper → DTO Response → JSON
```

### Patrón por feature

Cada endpoint tiene su carpeta en Application con:
- `*Request.cs` — parámetros de entrada (`IRequest<*Response>`)
- `*Response.cs` — DTO de salida
- `*Handler.cs` — lógica de negocio (`IRequestHandler<Request, Response>`)
- `*MapperProfile.cs` — mapping AutoMapper (solo si hay modelos de Infrastructure)

### Tres paths de datos

| Path       | Provider                    | Endpoints                                        |
|------------|-----------------------------|-------------------------------------------------|
| REST API   | `TastytradeApiProvider`     | MarketDataByType, OptionChains                   |
| WebSocket  | `TastytradeSocketProvider`  | Candle, Trade, Quote, Greeks                     |
| Combinado  | API + Socket + Black-Scholes| GammaExposure (ambos providers + cálculos B-S)  |

### Pipeline de middleware (en orden)

```
ExceptionHandlerMiddleware → DeveloperExceptionPage → Swagger → CORS → ApiKeyMiddleware → Controllers + MCP
```

CORS permite: `localhost:3039`, `localhost:5173` (React Monitor).

---

## Autenticación

- **API Key**: `ApiKeyMiddleware` valida header `X-API-KEY`. Bypass en `/swagger`, `/favicon.ico`, `/mcp`.
- **OAuth Tastytrade**: `TastytradeOAuth` singleton. Refresh token → access token (REST) + WebSocket token (DXLink). Cache thread-safe con lock.

---

## Protocolo WebSocket DXLink

Handshake fijo: `SETUP → AUTH → CHANNEL_REQUEST → FEED_SETUP → FEED_SUBSCRIPTION → FEED_DATA`

Cada llamada abre una conexión nueva, recibe datos, desuscribe y cierra.
Soporta multi-symbol subscription en un solo `FEED_SUBSCRIPTION` (usado en GammaExposure).

Timeouts: 10s (trade/quote/greeks), 15s (multi-candle), 30s (candle histórico).

---

## Formato de Símbolo OCC (21 chars)

```
SSSSSSYYMMDDTPPPPPQQQ
  6     6    1   8
```

| Parte | Chars | Descripción                         |
|-------|-------|-------------------------------------|
| S     | 6     | Símbolo padded con espacios         |
| YYMMDD| 6     | Fecha yyMMdd                        |
| T     | 1     | Tipo: C = Call, P = Put             |
| PPPPPQQQ | 8  | Strike × 1000, zero-padded          |

```
SPY   260516P00520000  =  SPY Put $520, expira 16-May-2026
```

`TastytradeHelper` convierte entre OCC y formato Tastytrade (`.SPY260516P520`).

**Encoding en URLs**: los espacios van como `%20`.
`SPY   260516P00520000` → `SPY%20%20%20260516P00520000`

---

## Endpoints

### 1. MarketData ByType — precio del equity

**GET** `/Data/Tastytrade/MarketData/ByType?Symbol={SYMBOL}`

Devuelve datos de mercado del equity (bid, ask, mid, mark, last, open, volume, beta).

```json
{
  "data": {
    "items": [{
      "symbol": "SPY",
      "bid": 528.10,
      "ask": 528.15,
      "mid": 528.125,
      "mark": 528.15,
      "last": 528.12,
      "open": 525.40,
      "volume": 62500000,
      "beta": 1.0
    }]
  }
}
```

**Uso en GaleCore**: Spot price para Capa 1 (Spot > ZGL) y Expected Move de Capa 2.
También usado para VIX9D y VIX3M (term structure).

---

### 2. Option Chains

**GET** `/Data/Tastytrade/OptionChains?Symbol={SYMBOL}`

Devuelve la cadena de opciones completa: todas las expiraciones y strikes disponibles.

**Uso en GaleCore**: Enumerar strikes para el motor de Capa 2.

---

### 3. Candle (OHLCV + Greeks históricos)

**GET** `/Data/Tastytrade/MarketData/Candle?Symbol={OCC}&Interval={interval}&FromTime={date}`

**Parámetros**:
- `Symbol`: OCC URL-encoded
- `Interval`: `d`, `1h`, `30m`, `15m`, `5m`, `1m`
- `FromTime`: `yyyy-MM-dd`
- `ToTime` (opcional)

```json
{
  "data": [{
    "eventType": "Candle",
    "eventSymbol": ".SPY260516P00520000{=d}",
    "open": 2.10, "high": 2.45, "low": 1.95, "close": 2.20,
    "volume": 8500,
    "impVolatility": 0.18,
    "openInterest": 42000,
    "delta": -0.15, "gamma": 0.008, "theta": -0.04
  }]
}
```

**Uso en GaleCore**: OI histórico (Capa 3: OI ≥ 2.000) y evolución de IV.

---

### 4. Trade

**GET** `/Data/Tastytrade/MarketData/Trade?Symbol={OCC}`

Último trade ejecutado del contrato.

```json
{
  "data": [{
    "eventType": "Trade",
    "eventSymbol": ".SPY260516P520",
    "price": 2.20,
    "size": 50,
    "dayVolume": 8500,
    "tickDirection": "DOWN"
  }]
}
```

---

### 5. Quote

**GET** `/Data/Tastytrade/MarketData/Quote?Symbol={OCC}`

Cotización bid/ask en tiempo real.

```json
{
  "data": [{
    "eventType": "Quote",
    "eventSymbol": ".SPY260516P520",
    "bidPrice": 2.18,
    "bidSize": 120,
    "askPrice": 2.22,
    "askSize": 80,
    "midPrice": 2.20
  }]
}
```

**Uso en GaleCore**: Capa 3 — spread bid-ask `(ask - bid) / mid ≤ 6%` y crédito del spread.

---

### 6. Greeks

**GET** `/Data/Tastytrade/MarketData/Greeks?Symbol={OCC}`

Greeks en tiempo real del contrato.

```json
{
  "data": [{
    "eventType": "Greeks",
    "eventSymbol": ".SPY260516P520",
    "price": 2.20,
    "volatility": 0.18,
    "delta": -0.15,
    "gamma": 0.008,
    "theta": -0.04,
    "rho": -0.003,
    "vega": 0.12
  }]
}
```

**Uso en GaleCore**: Greeks del portafolio, alerta de vega, IV para Capa 1.

---

### 7. TradeQuoteGreeks (Combinado)

**GET** `/Data/Tastytrade/MarketData/TradeQuoteGreeks?Symbol={OCC}`

Trade + Quote + Greeks en una sola llamada. Greeks solo si el símbolo es una opción.

```json
{
  "symbol": "SPY   260516P00520000",
  "trade": { "price": 2.20, "dayVolume": 8500 },
  "quote": { "bidPrice": 2.18, "askPrice": 2.22, "midPrice": 2.20 },
  "greeks": { "delta": -0.15, "gamma": 0.008, "theta": -0.04, "vega": 0.12, "volatility": 0.18 }
}
```

**Uso en GaleCore**: Endpoint principal para evaluar un contrato. Combina lo necesario para
Capas 2, 3 y monitoreo de posiciones.

---

### 8. Gamma Exposure (GEX)

**GET** `/App.Analytics/GammaExposure?Symbol={SYMBOL}&MinDelta={delta}&MaxDTE={dte}`

Calcula GEX por strike. Usa una sola conexión WebSocket para obtener OI + IV de todas las
opciones de la expiración regular más cercana (≤ MaxDTE) y calcula Greeks con Black-Scholes.

**Parámetros**:
- `Symbol`: Subyacente (ej: `SPY`)
- `MinDelta`: Delta mínimo absoluto para filtrar (default: `0.10`)
- `MaxDTE`: DTE máximo para expiraciones regulares (default: `60`)

```json
{
  "symbol": "SPY",
  "spot": 530.25,
  "expiration": "2026-05-16",
  "dte": 1,
  "expirationType": "Regular",
  "gammaZeroLevel": 525.75,
  "riskFreeRate": 0.045,
  "strikes": [
    {
      "strike": 520,
      "callDelta": 0.72, "callGamma": 0.0045, "callIV": 0.18, "callOI": 15000, "callGEX": 3.58,
      "putDelta": -0.28, "putGamma": 0.0045, "putIV": 0.20,  "putOI": 12000,  "putGEX": -2.86,
      "netGEX": 0.72
    }
  ]
}
```

**Lógica interna del handler**:
1. Option chains (REST) → filtra la expiración regular más cercana ≤ MaxDTE
2. Spot price (REST via ByType)
3. WebSocket → Candle de todos los strikes (OI + IV)
4. Black-Scholes → delta, gamma para cada strike
5. GEX = gamma × OI × 100 × spot² × 0.01 (millones, puts negativo)
6. Filtra por |delta| ≥ MinDelta
7. Interpola Gamma Zero Level (donde Net GEX cruza cero)

**Uso en GaleCore**: **Capa 1** — GEX ≥ $100B y Spot > ZGL (Gamma Zero Level).

---

### 9. IV Rank

**GET** `/App.Analytics/IVRank?Symbol={SYMBOL}`

IV Rank del subyacente (percentil de IV actual vs. rango histórico 1 año).

```json
{
  "symbol": "SPY",
  "ivRank": 42.0,
  "ivPercentile": 38.5,
  "timestamp": "2026-05-15T14:00:00Z"
}
```

**Uso en GaleCore**: **Capa 1** — IV Rank en rango 25–65.

---

### 10. Implied Volatility

**GET** `/App.Analytics/ImpliedVolatility?Symbol={SYMBOL}`

IV en múltiples horizontes (CBOE model-free) + IV histórica vía candles para iv_momentum.

```json
{
  "symbol": "SPY",
  "spot": 528.12,
  "riskFreeRate": 0.045,
  "iV30_9d": 17.45,
  "iV30_30d": 18.72,
  "iV30_90d": 19.10,
  "dailyMove": 1.18,
  "dailyMoveDollar": 6.23,
  "iV30_0d": 18.50,
  "iV30_3d": 17.20,
  "iV30RocPct": 7.56
}
```

| Campo         | Descripción                                                                                 |
|---------------|---------------------------------------------------------------------------------------------|
| `iV30_9d`     | IV a 9 días DTE — CBOE model-free sobre opciones en vivo (% anualizado, equiv. VIX9D)     |
| `iV30_30d`    | IV a 30 días DTE — CBOE model-free sobre opciones en vivo (% anualizado, equiv. VIX)      |
| `iV30_90d`    | IV a 90 días DTE — CBOE model-free sobre opciones en vivo (% anualizado, equiv. VIX3M)    |
| `iV30_0d`     | IV30 actual — última vela diaria del subyacente (`ImpVolatility × 100`). Fuente: `Candle?Interval=1d` |
| `iV30_3d`     | IV30 hace 3 sesiones — vela diaria `[−3]` del subyacente (`ImpVolatility × 100`)           |
| `iV30RocPct`  | Tasa de cambio 3 días: `((IV30_0d − IV30_3d) / IV30_3d) × 100`. Usado por `iv_momentum`   |

**Uso en GaleCore**:
- `iv_momentum` (Capa 1): usa `IV30RocPct` — si > 15% indica expansión de vol, no operar.
- `iv30_atm_roc_pct`: definición fuente única de verdad = `IV30RocPct` de este endpoint.

---

## MCP Server

DataFeed expone un servidor MCP en `/mcp` para integración directa con Claude Code.

### Configuración en `.mcp.json`

```json
{
  "mcpServers": {
    "datafeed": {
      "type": "http",
      "url": "http://localhost:7001/mcp",
      "headers": { "X-API-KEY": "${GALECORE_API_KEY}" }
    }
  }
}
```

El endpoint `/mcp` exige `X-API-KEY` (o JWT) desde WS-0048; sin clave responde 401.

### Tools disponibles

Todos en `DataFeed.Api/Infrastructure/McpTools.cs` — métodos estáticos con `[McpServerTool]`.

| MCP Tool               | Endpoint equivalente                          | Descripción                        |
|------------------------|-----------------------------------------------|------------------------------------|
| `GetMarketDataByType`  | `/Data/Tastytrade/MarketData/ByType`          | Precio, volumen, datos equity      |
| `GetOptionChains`      | `/Data/Tastytrade/OptionChains`               | Cadena de opciones completa        |
| `GetMarketDataCandle`  | `/Data/Tastytrade/MarketData/Candle`          | OHLCV + IV + Greeks históricos     |
| `GetMarketDataTrade`   | `/Data/Tastytrade/MarketData/Trade`           | Último trade via WebSocket         |
| `GetMarketDataQuote`   | `/Data/Tastytrade/MarketData/Quote`           | Bid/Ask en tiempo real             |
| `GetMarketDataGreeks`  | `/Data/Tastytrade/MarketData/Greeks`          | Greeks en tiempo real              |
| `GetTradeQuoteGreeks`  | `/Data/Tastytrade/MarketData/TradeQuoteGreeks`| Trade + Quote + Greeks combinado   |
| `GetGammaExposure`     | `/App.Analytics/GammaExposure`               | GEX por strike + Gamma Zero Level  |

### Cómo agregar un nuevo MCP Tool

1. Agregar método estático en `McpTools.cs`
2. Decorar con `[McpServerTool]` y `[Description("...")]`
3. Los parámetros con `[Description]` se exponen como inputs
4. Inyectar `IMediator mediator` como parámetro (DI automático)
5. Llamar al handler: `mediator.Send(new XxxRequest { ... })`
6. Serializar con `JsonSerializer.Serialize(response, _jsonOptions)`

---

## Mapping a las Capas GaleCore

| Capa GaleCore             | Endpoint DataFeed                     | Campo clave                             |
|---------------------------|---------------------------------------|-----------------------------------------|
| Capa 1 — Régimen/GEX      | ByType + **GammaExposure** + IVRank   | spot, GEX (≥$50B), gammaZeroLevel, ivRank (25–65) |
| Capa 1 — VIX TS           | ByType (VIX9D, VIX3M)                | iV9D < iV3M                             |
| Capa 2 — Motor strikes    | OptionChains + Greeks                 | strikes disponibles, IV (volatility)    |
| Capa 3 — Microestructura  | Quote + Candle                        | bid/ask spread, OI, volumen             |
| Capa 4 — Sizing           | Quote                                 | midPrice del spread (crédito)           |
| Monitoreo posiciones      | TradeQuoteGreeks                      | Greeks, P&L mark-to-market              |

---

## Convenciones de código

- **Lenguaje**: C# (.NET 8), comentarios en español
- **Hosting**: Minimal hosting en `Program.cs` (sin `Startup.cs`)
- **Paquetes clave**: MediatR, AutoMapper, Newtonsoft.Json, System.Text.Json, ModelContextProtocol.AspNetCore
- **Build**: `dotnet build DataFeed.sln`
- **Run**: `dotnet run --project DataFeed.Api`
- **Config**: `appsettings.Development.json` → ApiKey, Tastytrade OAuth, FRED API Key

---

## Cómo agregar un nuevo endpoint

1. **Infrastructure** (si aplica): Crear método en el provider correspondiente
2. **Application**: Crear carpeta con:
   - `NuevoFeatureRequest.cs` → `IRequest<NuevoFeatureResponse>`
   - `NuevoFeatureResponse.cs` → DTO de salida
   - `NuevoFeatureHandler.cs` → `IRequestHandler<Request, Response>`
   - `NuevoFeatureMapperProfile.cs` → perfil AutoMapper (si aplica)
3. **Api**: Agregar action en el controller:
   - `DataController` para datos puros de Tastytrade
   - `AppController` para features con lógica de negocio combinada
4. **MCP**: Agregar tool en `McpTools.cs` (recomendado)
5. **Test**: Verificar con Swagger en `/swagger`
