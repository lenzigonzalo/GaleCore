# GaleCore-AI

Harness de IA financiera sobre GaleCore: métodos (skills), agentes, perfil del trader, memoria con fuente,
validaciones y catálogo. No calcula hechos financieros ni consulta APIs externas por su cuenta: los datos vienen de
GaleCore. El objetivo, el catálogo de lo que el usuario puede pedir y el plan están en `../roadmap/README.md`; la forma
de trabajo en `../ENGINEERING.md`. Este archivo sólo dice cómo se usa y se prueba este repo.

```
GaleCore     = datos, cálculos, riesgo, SHADOW, monitor (verdad operativa)
GaleCore-AI  = método, criterio, memoria y validación determinística
Host         = ejecuta el modelo (hoy Claude Code)
```

## Antes de cambiar el repo

La pieza activa es la del `ACTIVE_WORK_ITEM` del workspace (el hook la muestra). Trabajá sólo en su alcance; el
implementer no marca su trabajo `VALIDATED` ni `CLOSED`. Antes de presentar una pieza como lista:
`python tools/engineering_gate.py`. Evidencia, revisión y estados: `../ENGINEERING.md` §1, §3, §9 y §12.

## Uso del producto

Las secciones de uso (contexto, herramientas, datos, cuenta, memoria, límites) están en `PRODUCT.md`:

@PRODUCT.md

## Entorno

La API Dev de GaleCore corre desde `../GaleCore` (`python dev/galecore_dev.py api`, `:7001`). La ApiKey nunca se
escribe en archivos.

```bash
export GALECORE_BASE_URL=http://localhost:7001   # en esta PC ya está en el entorno de usuario (HKCU), con la ApiKey
export GALECORE_API_KEY=<ApiKey de GaleCore>
export ALLOW_UNKNOWN_FRESHNESS=true   # PutSkew no trae timestamp
export MAX_STALENESS_SECONDS=36000    # registros diarios de régimen; 600 para GEX intradía
export GALECORE_TIMEOUT_SECONDS=300   # un GEX en frío puede pasar 120 s
```

Salida JSON; stdin se lee como UTF-8. Códigos: `0` éxito · `1` falla de prepare/registro/interna · `2` datos
insuficientes · `3` error de validación (también argumentos y `query` con un registro `INTEGRITY_FAILED`).

## Probar

```bash
python tools/engineering_gate.py
python -B -m pytest -q -p no:cacheprovider          # suite completa; para un cambio acotado, los tests del área
python -B -m ruff check --no-cache .
python -B -m galecore_ai.adapters.cli catalog --check   # cada capacidad carga y su flujo existe
```

## Referencia

- Uso desde el host, capacidad por capacidad: `docs/HOST-REFERENCE.md`
- Arquitectura: `docs/architecture/GaleCore-AI-arquitectura-v5.md` · contratos: `docs/architecture/P0-CONTRACTS.md`
- Guías de validación: `docs/LOCAL-VALIDATION-GEX-INTERACTIVE.md`, `docs/LOCAL-VALIDATION-REGIME-INTERACTIVE.md`
- Visor de registros: `docs/LOCAL-REGIME-VIEWER.md`
- Backlog: `docs/architecture/PRODUCT-BACKLOG.md` · histórico (no se sigue): `docs/archive/`
