# GaleCore

Plataforma tecnológica para automatización y análisis de estrategias con opciones financieras.

## Productos

- **Estrategias con opciones** — estrategia sistemática de venta de prima (Iron Condor, Put/Call Credit Spread) sobre índices líquidos (SPY, QQQ, IWM)
- **Backend DataFeed** — Web API .NET 8 que provee datos de mercado y cuenta vía Tastytrade / DXLink
- **Frontend Monitor** — Dashboard React + TypeScript para monitoreo de decisiones y posiciones

## Estructura

```
source/
├── galecore-datafeed/   # Backend API (.NET 8)
└── galecore-monitor/    # Frontend dashboard (React + TypeScript)
```

## Links

- API local: http://localhost:7001/swagger
- API producción: https://datafeed-g5b4dkfccda5hkdh.chilecentral-01.azurewebsites.net/swagger/index.html
- Monitor local: http://localhost:3039
