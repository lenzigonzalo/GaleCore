---
id: GC-0038
title: Skills — listado, resumen y contenido legibles
status: READY_FOR_REVIEW
approver: user
---

Pedido directo del owner, 23/10/2026, capturas Screenshot (31) a (34). Pieza local acotada, sin modificar WS-0055.
Rama: local/skills-ux. Presupuesto estándar de ENGINEERING.md.

## Contrato

- Configuración → Skills: listado con búsqueda por nombre/contenido y filtros Todas, Tuyas, De la plataforma.
- Abrir una skill muestra ficha con Resumen y Contenido; contenido completo en vista previa y Markdown, incluso en skills de plataforma.
- Texto de lectura 18 px, listado 16–18 px; tema y tipografía compartidos, composición adaptable.
- Mantener creación, edición y borrado de skills propias privadas. Plataforma de solo lectura. Fallos al guardar conservan borrador y muestran error.
- No inventar descripción, archivos, autor ni controles de ejecución: usar datos del espacio existentes.
- Fuera de alcance: backend, contratos, activación y ejecución en chat, despliegue.
- Recorrido: Configuración → Skills → buscar → abrir → Resumen → Contenido → Markdown → volver; crear/editar skill propia.
- Verificación: tests del área, build CI, diff check y QA visual si hay navegador. Revisión independiente y aprobación del owner antes del cierre.

## Evidencia y para retomar

23/10/2026: implementado en local: listado buscable y filtrable; ficha con resumen e índice de secciones reales (omite ejemplos fenced), origen publicado, versión/fecha; contenido en vista previa de 18 px y Markdown; creación/edición privada y borrado con confirmación. Errores conservan borrador. Pestañas con flechas/Home/End y foco al entrar en ficha.

Fuente conservada: `GaleCore-AI/src/galecore_ai/application/space.py`, `local_pieces` publica catálogo como skills shared bajo el usuario actual; `sync` las guarda en `items`. No se mezclan skills de otros owners desde `shared`.

Ejecutado:
- `CI=true npm test -- --watchAll=false --runInBand --runTestsByPath src/components/settings/SkillsView.test.tsx src/pages/SettingsConnections.test.tsx src/components/settings/SettingsModal.test.tsx`: exit 0, 7 tests, 3 suites.
- `CI=true npm run build`: primer intento sandbox falló con `spawn EPERM`; repetición fuera del sandbox exit 0, `Compiled successfully`. Build final de consolidación: exit 0, Compiled successfully (main.a1113d1a.js).
- `git diff --check`: exit 0.

QA visual/recorrido real pendientes: `cua.getState()` devolvió inventario vacío y `cua.createBrowserTab('iab', 'http://localhost:3039')` devolvió `Browser is not available: iab`. Las pruebas de componentes y el build no acreditan apariencia ni persistencia real.

Revisión independiente: `docs/engineering/reviews/GC-0038-skills-ux.md`. Corregidos tamaño de bloques de código y encabezados de ejemplos en el índice.

Para retomar: abrir Configuración → Skills, buscar una skill y recorrer Resumen → Contenido → Markdown; comprobar móvil y crear/editar una propia en Dev. Pendiente QA visual y aprobación del owner. No VALIDATED/CLOSED; WS-0055 conserva su estado.
