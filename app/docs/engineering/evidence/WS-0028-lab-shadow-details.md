# WS-0028 — Detalles de SHADOW y propuesta de ficha viva

Owner 12/10/2026: nombre repetido al abrir SHADOW, «timeout of 15000ms exceeded», controles
superiores un poco mayores; pensar un artefacto editable de estrategia dentro del contexto del usuario.
WS-0029 sigue activo. Fixes locales en worktree WS-0028, sin producción ni cambios de plan.

## Contrato de los fixes

Entrada: proyecto de estrategia → pestaña Shadow. No repetir el nombre del proyecto dentro del contenido;
versión legible. Una consulta de runtime fallida no oculta la preparación de la estrategia. Timeout
humano, reintento, pendiente/error separados de ausencia real de datos; versión desplegada sin comprobar
no se marca como diferente. Controles superiores algo mayores conservando la composición centrada.

Fuera: editor de estrategia, transporte de artefactos/contexto, permisos, aprobaciones/despliegues,
backend y diagnóstico de rendimiento de base. No se escriben estrategias ni se invoca al modelo.

## Diagnóstico y cambio

- `api/client.ts` define 15000 ms globales. LabShadow agrupaba estrategia, métricas y estado en
  un Promise.all: un fallo anulaba toda la vista. Se separan preparación y runtime con estados propios.
- Lecturas GET reales de API Dev, clave sólo en memoria y nunca registrada: Status HTTP 200 en 0,03 s;
  Metrics HTTP 200 en 10,53 s, seis versiones. La corrida no reprodujo el timeout ni prueba su causa backend.
  Metrics ahora tiene un plazo específico de 30000 ms; no cambia el default de las otras consultas.
- Título de contenido «Preparación y ejecución», nombre conservado en sidebar/cabecera; versión visible
  sin repetir la referencia completa. No se reescriben nombres, historial ni archivos de estrategias.
- Filtros por specName, hash exacto, chequeo de integridad y disponibilidad de persistencia conservados.
  Si no se conoce el hash canónico, una instancia dice «Versión sin comprobar».
- Toggles Monitor/Operativa/Lab y Chat/Shadow algo mayores, sin cambiar letra de mensajes/caja.

## La propuesta del owner y su destino

Registrada por el CLI, procedimiento `/idea`, en
`inbox:2026-10-13-estaria-bueno-ver-en-shadow-como` (fecha UTC generada por la herramienta),
`knowledge/inbox/2026-10-13-estaria-bueno-ver-en-shadow-como.json` del workspace.
Destino `backlog:BL-005`; no se editó el backlog concurrente. Veredicto: **ya está en el plan**,
U-29/U-52 y P1-10. El catálogo devolvió `strategy_design` y `strategy_project`.

Recomendación para discutir: **Diseño** (ficha viva) y **SHADOW** (ejecución observada) del mismo proyecto.
La ficha muestra tesis/objetivo, entrada, gestión, salida, parámetros/unidades, riesgos, pendientes y
cobertura por regla: ejecutada, sólo avisada o no cubierta. El usuario puede editar parámetros o pedir
cambios al chat; se guarda una nueva versión con sus cambios y contexto, sin alterar la desplegada.
El chat referencia la ficha/version canónica y los campos modificados, no una captura ni una segunda
fuente financiera. Guardar diseño no aprueba ni despliega.

Existe `strategy sheet` con parámetros, gestión, riesgos y faltantes, y `project show` con contexto
versionado. Reutilizarlos para una primera ficha real de lectura; después editor y sincronización de
contexto. La ruta actual del puente no sirve aún ese ciclo editable. Esta propuesta no lo implementa
ni activa su prioridad. No requiere un modelo para repintar datos ni sumar un dashboard configurable.

## Verificación y para retomar

- Chromium aislado con Lab/WorkspaceHeader reales y adaptadores de QA: exit 0. Timeout conserva
  propuesta, mensaje humano y reintento; runtime pendiente no dice «sin métricas»; persistencia
  ausente e integridad generan error explícito; con hash canónico pendiente/fallido, instancia
  no se etiqueta «Otra versión». Nombre de proyecto aparece en navegación y cabecera, no otra
  vez dentro de SHADOW; versión visible `1.0` y referencia completa conservada en title.
- Toggles mayores: barra general 55,5 px y barra de proyecto 49 px en viewport 1600 px;
  conversación 1024 px, caja 960 × 92 px, letras 18/16 px. Responsive, foco, sidebar, borradores,
  scroll, settings y menú de cuenta siguen verdes. Errores JS `[]`.
- Captura `C:/Users/lenzi/OneDrive/Escritorio/GaleCore/.tmp/lab-composer-qa/shadow-timeout.png`
  inspeccionada. Fixtures de estado/error explícitos, no estrategia/ejecución real ni prueba de
  transporte Axios a 30 s. Preview `:3041` regenerada con proyecto de prueba sin escrituras.
- Review estático independiente de otro Sol 6.1:
  `docs/engineering/reviews/WS-0028-lab-shadow-read-review.md`, CHANGES_REQUESTED por F1:
  versión desconocida se presentaba como diferente. Corregido por implementer y probado con
  estrategia pendiente/fallida e instancia de hash conocido; sin recheck ni edición del review.
- Diagnóstico reproducible/sanitizado: `lab-composer-qa/diagnose-shadow.py` y
  `lab-composer-qa/shadow-api-diagnostic.json` junto a esta evidencia. Requiere GALECORE_API_KEY;
  sólo GET a localhost Dev, nunca imprime ni persiste la clave. El listado real de seis métricas
  no se convirtió en un fixture financiero.
- `git diff --check` y `CI=true npm run build` final con F1: exit 0. Commit `b74238a` integrado
  en `local/integracion`. Monitor servido: HTTP 200, lectura parcial SHADOW presente en bundle,
  errores JS `[]`; preview visible. Comprobación de login/bundle, no E2E autenticado.

La corrección no declara validada la pieza ni resuelta la causa backend del timeout. Próxima
propuesta de interfaz: ficha real, recuperable, versionada y enlazada al chat; alcance/contrato
antes de programar edición. WS-0029 sigue activo; no se reiniciaron servicios ni se tocaron pruebas.
