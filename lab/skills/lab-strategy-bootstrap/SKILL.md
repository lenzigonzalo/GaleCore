---
name: lab-strategy-bootstrap
description: Iniciar o retomar una estrategia desde una conversación de GaleCore Lab cuando el usuario pide trabajar una estrategia sobre un símbolo, diseñarla o preparar su recorrido E2E a SHADOW. Coordina las capacidades del harness existente. No activar para chat personal ni una consulta aislada de precio.
---

# Bootstrap de estrategia en Lab

El proyecto seleccionado es el workspace. Una carpeta no prueba que haya estrategia registrada, aprobada o desplegada. No continuar ACTIVE_WORK_ITEM: es trabajo del trader.

1. Primer mensaje de una idea: no leas documentos ni consultes antes de contestar. Usá el contexto del turno (perfil, reloj, mapa de GaleCore, datos traídos por código) y seguí los dos tiempos de «cómo responder»: aclarar rápido, buscar cuando el trader confirma.
2. Leé AGENTS.md, README.md, `docs/HOST-REFERENCE.md` o el flujo de una capacidad (`catalog --match`) sólo cuando vayas a usar un comando que no conocés o a guardar un registro. `kb search` y `project show strategy:<nombre>` sólo si el trader habla de algo ya trabajado.
3. Al buscar, traé de una vez lo anunciado (consultas en paralelo). Distinguir hechos, hipótesis y datos faltantes. No convertir defaults en evidencia.
4. Arrancar por tesis: mecanismo, horizonte, cómo se expresa, invalidación y decisiones faltantes. Preguntar sólo lo que antecedentes y perfil no resuelvan. Una estructura por sí sola no es una estrategia. Mencionar SPY no autoriza elegir parámetros ni desplegar.
5. Guardar investigación/decisiones con research/project/feedback canónicos. Aplicar strategy_design para hipótesis, reglas, parámetros, árbol de gestión y evaluación. Documentos legibles y convenciones viven en el workspace; registros canónicos mantienen su fuente y cadena.
6. Progresar por hechos: investigación → propuesta → strategy check/save → crítica de versión exacta → strategy sheet → aprobación explícita del hash → deploy-check → despliegue SHADOW Dev autorizado → evaluación real. Declarar gaps/bloqueos, sin saltar pasos.
7. Guardar por hito; git status/diff en knowledge y commit local sólo de archivos propios, sin git add ., secretos ni push. Mostrar rutas y hash comprobado, junto con siguiente paso. Un chat guardado por Lab no demuestra memoria ni commit.

## Shadow

No aprobar por el usuario ni enviar órdenes LIVE. La aprobación requiere palabras explícitas sobre versión y hash. Deploy sigue galecore_dev.py con archivo de aprobación y Dev; nunca llamar Deploy directamente. Antes de detener/reemplazar una instancia, informar abiertas y efecto y obtener autorización. La UI muestra hechos por spec/versión, sin inventar métricas ni atribuir agregados a una instancia.

## Casos de aceptación

- «Acá vamos a trabajar una estrategia en SPY»: recuperar antecedentes/perfil/contexto e iniciar tesis; sin parámetros asumidos, aprobación o deploy.
- «Retomá esta estrategia y dejala lista para Shadow»: leer versión/pendientes, validar y criticar antes de pedir aprobación concreta.
- «Quiero hablar de cosas personales»: no activar bootstrap ni consultar cuenta o estrategia.
