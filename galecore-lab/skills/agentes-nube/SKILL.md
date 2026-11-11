---
name: agentes-nube
description: Crear un agente que corre solo en la nube (una rutina de claude.ai) y aplicar los pedidos pendientes de la pestaña Agentes. Dos entradas: el trader pide en el chat «creame un agente que…», o el Lab aplica los pendientes sin chat. No usar para tareas de la PC.
---

# Agentes en la nube

Un agente en la nube es una rutina de claude.ai que corre a su hora sin la PC, lee GaleCore y deja su resultado en la pestaña Agentes. Se registra como una pieza del espacio (`runs_on: "cloud"`); vos sólo armás la rutina con `RemoteTrigger`, el resto lo arma el producto. Sólo con motor Claude: con Codex decilo y no crees nada.

Todos los comandos son `python -m galecore_ai.adapters.cli agent …`.

## Entrada 1: el trader lo pide en el chat

1. Pedí sólo lo que falte de tres cosas: nombre, qué hace, cuándo (una vez por día: todos los días, de lunes a viernes o días elegidos, con hora y zona; o cada 1 h en rueda).
2. Si necesita archivos de la PC o correr cada menos de 1 hora, no es de la nube: es una tarea de la PC y sigue el camino de siempre (`capability_builder`).
3. `agent new --name "<nombre>" --what "<qué hace>" --when '{"frequency":"daily","time":"08:00","timezone":"America/New_York"}'` (`frequency`: `daily`, `weekdays` o `days` con `"days":["mon","wed"]`; cada 1 h en rueda es `{"frequency":"market_hours","minutes":60,"timezone":"America/New_York"}`).
   Si quiere que el agente use una skill (con código o sólo markdown), ofrecé las de su espacio (`space list --kind skill` o el contexto) y sumá `--skill <clave>` por cada una, de 1 a 5 (el flag se repite). El agente baja la carpeta completa y sigue su `SKILL.md`; los cálculos los corre con `skill run`. Las corridas y los avisos quedan guardados solos. Si la skill no existe, primero se crea con `skills-con-codigo`.
4. Decí en una línea: «en menos de un minuto aparece en Agentes». No la apliques vos: el Lab lo hace solo. Si `agent env` dice que falta configurar el entorno, decilo en una línea y seguí.

## Entrada 2: aplicar pendientes (sólo el Lab, sin chat)

Por cada elemento de `agent pending`:

1. `agent body <clave>` devuelve `{action, trigger_id?, body?}`. Si falla, el error ya dice qué falta: pasalo con `agent applied <clave> --error "<el mensaje>"` y seguí con el siguiente.
2. Llamá a `RemoteTrigger` con esa acción y ese cuerpo tal cual, sin cambiarlo: `create`, `update` (con `trigger_id`) o `run` (con `trigger_id`). Pausar es `enabled: false` en el cuerpo.
3. Conectores: `create` adjunta todos los conectores de la cuenta y una lista vacía se ignora. Pasá la lista mínima de conectores; si la rutina creada igual los tiene, hacé un `update` con un solo conector inocuo (p. ej. Claude_Docs).
4. Avisá el resultado con `agent applied <clave> --trigger-id <id> --url <link de la rutina>` (el link es `https://claude.ai/code/routines/<id>`). Si `RemoteTrigger` falló: `agent applied <clave> --error "<qué pasó, en una línea>"`. Para `run` alcanza `agent applied <clave>`.

Borrar: `agent body` ya devuelve el `update` con `enabled: false`; mandalo y avisá con `agent applied <clave>`, que saca el agente de la lista.

No cuentes el resultado en texto: lo que vale es lo que dejó `agent applied`. No borres rutinas (pausar alcanza; se borran en claude.ai). Una a la vez, sin tocar nada más.
