# GaleCore — Sistema de trabajo (2 personas, poco tiempo, IA-first)

> **Superado (2026-09-16):** la forma de trabajo del ecosistema vive en el workspace, `../../ENGINEERING.md` (github.com/lenzigonzalo/galecore-workspace). Este archivo se conserva por sus secciones específicas de GaleCore (fuentes de verdad de la plataforma §1, harness de research §3, agente pre-market §4, cadencia de paper §5). Si contradice a `ENGINEERING.md`, gana `ENGINEERING.md`.

Cómo trabajamos para llegar a **paper corriendo y midiendo** sin vivir mirando el mercado.
Documento vivo. Somos 2, con 8 hs de laburo ajeno: todo lo que se pueda delegar a IA/automatización, se delega.

---

## 1. Fuentes de verdad (una por tema, sin duplicar)

| Tema | Fuente | Regla |
|---|---|---|
| Arquitectura (backend/front/endpoints) | `CLAUDE.md` | Se actualiza ante cada cambio de arquitectura/endpoint/componente. |
| Config de la **aplicación** | `.../Files/galecore_rules_core.json` | Universo, `strategies[]`, `monitor`. **Nada de trading.** |
| **Operativa** de cada estrategia | `.../Files/<Prefijo>/galecore_rules_<prefijo>.json` | **JSON primero**, luego código, luego docs. Nunca al revés. |
| Racional (*por qué* de cada parámetro) | `docs/<estrategia>/` (hoy `docs/rpf/`) | Acompaña al JSON de esa estrategia. |
| Validaciones empíricas | `docs/rpf/galecore-research-backtesting-rpf.md` | Bitácora del backtesting BT-0..BT-17. |
| Skills de IA | `.claude/commands/*.md` | Guías de activación, **no** copias de la estrategia (eso genera drift). |

Todo lo superado → `docs/archive/` con cabecera "superado". Índice en `docs/README.md`.

## 2. Flujo de git (nada de 13 ramas otra vez)

- Trunk **`master`**. Ramas `feat/*` / `chore/*` de **vida corta**.
- **Nunca push directo a master.** Commit local → confirmación del operador → push + **PR**.
- PR mergeado → borrar la rama (local y remota). Revisión semanal de ramas huérfanas.
- Trabajar **siempre desde `GaleCore/GaleCore/`** (git vive ahí, no en la raíz).

## 3. Harness (3 capas)

1. **Research/backtest** ✅ — `research/backtesting/` con specs pre-declaradas + datasets versionados.
   Es nuestro mejor activo de disciplina; todo cambio de estrategia se valida acá antes de tocar el JSON.
2. **Backend** ⏳ — pendiente: (a) test que valide los 3 JSON (parseo + cero overrides huérfanos del
   DeepMerge), (b) smoke-test de los endpoints GaleCore, (c) CI de GitHub Actions que compile + corra
   esos tests en cada PR.
3. **Operativo (humano)** ⏳ — el ritual diario de paper (§5), asistido por el agente pre-market (§4).

## 4. Agentes de IA (lo que reemplaza mirar el mercado)

Herramientas disponibles: Claude Code (`/schedule`, `/loop`, agentes), connectors MCP
(AlphaVantage con `HISTORICAL_OPTIONS`, IoL, Gmail, Drive).

### 4.1 Agente pre-market (DISEÑO — sin activar)

- **Qué hace:** cada día hábil ~1h antes de la apertura, lee el estado de la estrategia operativa
  (hoy RPF) sobre SPY contra el DataFeed productivo.
- **Salida:** un resumen accionable — "HAY señal PCS en SPY: vender put $X / comprar put $Y, crédito
  $Z, delta W, edge E" o "SIN señal (murió en gate: VRP)". Lo manda por **Gmail** (MCP) o lo deja en Drive.
- **Cómo montarlo:** `/schedule` (routine cron) con un prompt fijo que: (1) consulta el estado,
  (2) formatea el veredicto del embudo, (3) envía el mail. Cron sugerido: L-V 09:00 ART (~pre-open NY).
- **Pendiente de diseño:** el endpoint REST que usaba (`GET /App/GaleCore/ValidationLayer`) se
  eliminó con la estrategia v1.4.0. RPF publica su estado por SignalR (`ReceiveRpfState`), no por
  REST — hay que decidir si se le expone un `GET /App/Rpf/State` o si el agente se cuelga del hub.
- **Guardarraíl:** el agente **informa**, no opera. La ejecución (aunque sea en paper) es humana.

### 4.2 AlphaVantage para históricos de opciones

`HISTORICAL_OPTIONS` (MCP ya conectado) ataca el dolor de "datos históricos de opciones gratis son
escasos/rotos". Útil para validar el dataset propio (ver `reference_spy_options_dataset_quirks`) y
para futuros ciclos de research.

### 4.3 Memoria de Claude

Convenciones, decisiones y feedback persisten en la memoria del proyecto. Convertir decisiones
no-obvias en memorias; no duplicar lo que ya está en git/código.

## 5. Cadencia

- **Diario (5 min):** leer el mail del agente pre-market → si hay señal, ejecutarla en paper y
  registrar. El sistema decide; el humano ejecuta.
- **Semanal (30 min):** revisar PRs abiertos, comparar resultados de paper vs backtest, podar ramas,
  actualizar `CLAUDE.md` si hubo cambios de arquitectura.
- **Por ciclo de estrategia:** todo cambio de lógica pasa por research → JSON → backend → front → skill.

## 6. Objetivo y realidad

Meta inmediata: **paper corriendo y midiendo bien**. La cifra de $/mes se define al capitalizar
(config C ≈ 6,4%/año; $200/mes ≈ ~$32k). No se baja ningún gate para "forzar" retorno — eso es la
palanca más cargada de cola.
