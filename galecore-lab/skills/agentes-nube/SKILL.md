---
name: agentes-nube
description: Crear un agente que corre solo en la nube (una rutina de claude.ai) y aplicar los pedidos pendientes de la pestaña Agentes. Dos entradas: el trader pide en el chat «creame un agente que…», o el Lab aplica los pendientes sin chat. No usar para tareas de la PC.
---

# Agentes en la nube

Un agente en la nube es una rutina de claude.ai que corre a su hora sin la PC, lee GaleCore y deja su resultado en la pestaña Agentes. Se registra como una pieza del espacio (`runs_on: "cloud"`); vos sólo armás la rutina con `RemoteTrigger`, el resto lo arma el producto. Sólo con motor Claude: con Codex decilo y no crees nada.

Todos los comandos son `python -m galecore_ai.adapters.cli agent …`.

## Entrada 1: el trader lo pide en el chat

1. Pedí sólo lo que falte de tres cosas: nombre, qué hace, cuándo (una vez por día como máximo: todos los días, de lunes a viernes o días elegidos, con hora y zona).
2. Decí en una línea dónde corre y por qué: en la nube, a su hora y con la PC apagada. Si necesita archivos de la PC o correr cada menos de 1 hora, no es de la nube: es una tarea de la PC y sigue el camino de siempre (`capability_builder`).
3. Antes de crear, verificá el entorno con `agent env` (devuelve `environment_id`). Si falla con «Falta configurar el entorno», pedile al trader el link del entorno de claude.ai de sus agentes y guardalo con `agent env --set "<link>"`.
4. `agent new --name "<nombre>" --what "<qué hace>" --when '{"frequency":"daily","time":"08:00","timezone":"America/New_York"}'` (`frequency`: `daily`, `weekdays` o `days` con `"days":["mon","wed"]`).
5. Decí en una línea que el Lab crea la rutina en menos de un minuto y que aparece en Agentes. No la apliques vos: el Lab lo hace solo.

## Entrada 2: aplicar pendientes (sólo el Lab, sin chat)

Por cada elemento de `agent pending`:

1. `agent body <clave>` devuelve `{action, trigger_id?, body?}`. Si falla con «Falta configurar el entorno», pedile al trader en el chat el link del entorno de claude.ai de sus agentes, guardalo con `agent env --set "<link>"` y repetí.
2. Llamá a `RemoteTrigger` con esa acción y ese cuerpo tal cual, sin cambiarlo: `create`, `update` (con `trigger_id`) o `run` (con `trigger_id`). Pausar es `enabled: false` en el cuerpo.
3. Conectores: `create` adjunta todos los conectores de la cuenta y una lista vacía se ignora. Pasá la lista mínima de conectores; si la rutina creada igual los tiene, hacé un `update` con un solo conector inocuo (p. ej. Claude_Docs).
4. Avisá el resultado con `agent applied <clave> --trigger-id <id> --url <link de la rutina>` (el link es `https://claude.ai/code/routines/<id>`). Si `RemoteTrigger` falló: `agent applied <clave> --error "<qué pasó, en una línea>"`. Para `run` alcanza `agent applied <clave>`.

No cuentes el resultado en texto: lo que vale es lo que dejó `agent applied`. No borres rutinas (pausar alcanza; se borran en claude.ai). Una a la vez, sin tocar nada más.
