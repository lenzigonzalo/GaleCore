# GC-0035 — revisión independiente de proveedores y favoritos

Fecha: 22/10/2026. Reviewer independiente: Codex. Una sola pasada; este informe no aprueba ni cierra el work item.

## Alcance y snapshot

Revisé estáticamente el diff sin commit contra `HEAD` en la rama `feature/GC-0035-agentes-y-favoritos`, dentro del checkout `C:/Users/lenzi/OneDrive/Escritorio/GaleCore/GaleCore`. `HEAD` y `local/integracion` apuntaban a `d91f16663a210ab14b662c02b910f3b5459f5d0e`.

El árbol estaba **dirty**: nueve archivos modificados bajo `source/galecore-monitor/src/` (`LabProjectList.{tsx,css,test.tsx}`, `Connections.{tsx,test.tsx}`, `LocalMcp.{tsx,test.tsx}` y `Settings.{tsx,css}`), más `docs/engineering/work-items/GC-0035-agentes-y-favoritos.md` y `docs/engineering/evidence/GC-0035/` sin trackear. Este informe se agrega también sin commit. No modifiqué la implementación.

Contrasté el cambio con el pedido del owner y el contrato de GC-0035: selector por proveedor con Cuenta, Permisos, Servidores MCP y Skills; proveedor visible por conversación; favoritos de proyectos y chats persistidos junto con la organización existente; orden de favoritos; compatibilidad con preferencias previas; y aumento de tipografía. Revisé además la integración existente de autenticación, inventario MCP y espacio privado. No hubo navegador disponible, por lo que la apariencia no quedó evaluada en esta pasada.

**Resultado: CHANGES_REQUESTED por F1.** F2 es menor, pero conviene resolverlo en el mismo ajuste. No corresponde marcar GC-0035 `VALIDATED` ni `CLOSED`.

## F1 — P1: marcar un favorito durante la carga puede sobrescribir grupos y colores de la cuenta

Ubicación: `source/galecore-monitor/src/components/lab/LabProjectList.tsx:87-106,162` y `source/galecore-monitor/src/components/lab/LabProjectList.test.tsx:188-203`.

La pantalla arranca con la copia de `localStorage` y pide en paralelo la preferencia canónica `chat-grupos`. Cualquier estrella llama a `organize`, que pone `changed.current = true`. Si el usuario pulsa una estrella antes de que termine `fetchSpace()`, la respuesta de la cuenta se descarta por el guard de la línea 93. Después del debounce se guarda el objeto local completo, no sólo el cambio de favorito.

Así, con una copia local vacía o vieja y una preferencia de cuenta que sí contiene grupos, membresías o colores, un clic rápido produce este orden: se marca el favorito sobre la copia local; llega la preferencia de cuenta pero no se hidrata; `saveSpaceItem` sobrescribe la cuenta con la copia local más `favorites`. Se pierden silenciosamente la organización y los colores canónicos. Esto contradice tanto «lo guardado en el espacio manda» como el criterio de conservar grupos y colores al incorporar el campo nuevo.

La prueba agregada no cubre la carrera: `fetchSpace` resuelve inmediatamente y no aporta una preferencia remota distinta. Hace falta conservar el cambio temprano como delta y aplicarlo después de hidratar, o bloquear/encolar las mutaciones hasta conocer el estado canónico. Una prueba con `fetchSpace` diferido, copia local distinta y clic antes de resolver debería verificar que el guardado final contiene los grupos, membresías y colores remotos junto con el favorito nuevo.

## F2 — P3: el fallo de persistencia se muestra dos veces en la pestaña Proyectos

Ubicación: `source/galecore-monitor/src/components/lab/LabProjectList.tsx:191,198`.

El nuevo aviso global de `storageError` permite mostrar el problema también en Conversaciones, pero quedó el aviso anterior dentro de la rama Proyectos. Cuando `saveSpaceItem` falla y la pestaña activa es Proyectos, se renderizan dos párrafos idénticos con `role="status"`, por lo que el usuario ve y las tecnologías de asistencia anuncian dos veces el mismo error. Debe quedar una sola instancia.

## Evaluación restante

- Las preferencias antiguas sin `favorites` se normalizan a una lista vacía sin descartar grupos, membresías ni colores. Los identificadores de favoritos conservan el prefijo `p:`/`c:` y se guardan en la misma preferencia privada.
- El orden mantiene los grupos y prioriza favoritos dentro de los subconjuntos ya existentes; las conversaciones no favoritas conservan el orden por actividad reciente.
- Cada conversación muestra `Claude Code` o `Codex` desde el proveedor fijado en el chat. El selector de modelo de conversaciones existentes continúa bloqueado fuera de este cambio.
- Configuración presenta Cuenta, Permisos, Servidores MCP y Skills para ambos proveedores. Cuenta reutiliza el estado real y la terminal de reautenticación; no habilita reautenticar cuando falta el CLI o falla el servicio. Permisos sólo explica el control vigente por chat. MCP reutiliza el inventario existente filtrado por proveedor y Skills reutiliza los datos del espacio.
- No aparece un formulario ficticio de API keys, no vi cambios de permisos efectivos, secretos, producción, broker ni ejecución de órdenes.
- Los tamaños pedidos quedan declarados en CSS: proyectos 16 px, chats 15 px y proveedor 12 px. La estrella es un botón con `aria-pressed`, foco visible y posición anterior al selector del elemento. La comprobación visual en tamaños reales sigue pendiente.

## Verificación y límites

- Ejecuté `git diff --check`: terminó sin errores.
- No ejecuté tests ni build en esta pasada de lectura. Leí la evidencia de la sesión principal en `docs/engineering/evidence/GC-0035/README.md`: registra 5 suites / 27 tests verdes y build CI exitoso. Esos resultados pertenecen al implementer y no reproducen la carrera de F1.
- No ejecuté autenticaciones, MCP reales ni servicios y no leí credenciales.
- El navegador no estaba disponible (`cua` sin superficies e IAB no disponible), así que no se acredita QA visual ni el recorrido completo del usuario. El owner conserva la decisión de aceptación y cierre.
