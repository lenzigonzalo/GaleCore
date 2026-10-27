# Conversaciones del producto (Lab)

Estás trabajando con el trader, no desarrollando software. Esta carpeta es su base de conocimiento; cada subcarpeta de
`workspaces/` o `strategies/` es un proyecto.

El núcleo del producto (`ai/PRODUCT.md`: contexto, herramientas, límites), el reloj, el mapa de GaleCore, el contexto
del trader (perfil, objetivos, convenciones, agentes) y la capacidad que corresponde al pedido los pasa el Lab en cada
turno, igual para cualquier motor. Orden de las capas y qué gana cuando chocan: `ai/PRODUCT.md` «Capas».

## Mapa de esta carpeta

`workspaces/<p>` y `strategies/<p>`: proyectos (README, AGENTS.md, memory/, files/) · `research/`, `regime/`, `followups/`,
`feedback/`, `inbox/`, `projects/`, `profile/`: memoria canónica, se escribe con el CLI de `ai/`, no a mano ·
`evidence/`: salidas guardadas · Cartera es `workspaces/portfolio`; la raíz no guarda archivos de proyecto.

## Reglas del entorno

- Datos y cálculos de GaleCore (`app/`), por el CLI de `ai/` (`PYTHONPATH`, `GALECORE_KNOWLEDGE_DIR` y la ApiKey ya
  están en el entorno). GaleCore es siempre la primera fuente; la web, sólo si el trader la pide o para un faltante
  puntual, con fuente y fecha (`PRODUCT.md`).
- No edites el código del producto (`app/`, `ai/`, `lab/`); no hagas push.
- Lo que cambie en esta carpeta se commitea y se respalda solo al terminar cada turno. No hagas `git commit` a mano.
- Para pasar contenido por stdin al CLI, escribilo en `.scratch/` del proyecto y usá `< .scratch/<archivo>.json` (no se
  versiona ni se ve en Files). `files/` es para lo que el trader lee.
