# GaleCore-AI

Harness de IA financiera sobre GaleCore: métodos (skills), agentes, perfil del trader, memoria con fuente,
validaciones y catálogo. No calcula hechos financieros ni consulta APIs externas por su cuenta: los datos vienen de
GaleCore (`../app/`). Este archivo sólo dice cómo se usa y se prueba `ai/`.

```
app          = datos, cálculos, riesgo, SHADOW, monitor (verdad operativa)
ai           = método, criterio, memoria y validación determinística
Host         = ejecuta el modelo (hoy Claude Code)
```

## Uso del producto

Las secciones de uso (contexto, herramientas, datos, cuenta, memoria, límites) están en `PRODUCT.md`:

@PRODUCT.md

## Entorno

La API Dev de GaleCore corre desde `../app` (`python dev/galecore_dev.py api`, `:7001`). La ApiKey nunca se
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
python -B -m pytest -q -p no:cacheprovider          # suite completa; para un cambio acotado, los tests del área
python -B -m ruff check --no-cache .
python -B -m galecore_ai.adapters.cli catalog --check   # cada capacidad carga y su flujo existe
```

## Referencia

- Uso del producto, capas de contexto y motor: `PRODUCT.md` (arriba)
- Uso desde el host, capacidad por capacidad: `docs/HOST-REFERENCE.md`
- Contratos del código (anteriores a D-0012/D-0014; en capas y motor manda `PRODUCT.md`):
  `docs/architecture/P0-CONTRACTS.md`, `docs/architecture/GaleCore-AI-arquitectura-v5.md`
- Reglas de payload de GEX y régimen: `docs/LOCAL-VALIDATION-GEX-INTERACTIVE.md`, `docs/LOCAL-VALIDATION-REGIME-INTERACTIVE.md`
- Backlog: `docs/architecture/PRODUCT-BACKLOG.md` · histórico (no se sigue): `docs/archive/`
