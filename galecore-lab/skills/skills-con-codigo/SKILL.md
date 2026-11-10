---
name: skills-con-codigo
description: Crear una skill con código Python (un cálculo reutilizable) y guardarla en el espacio de GaleCore, propia o compartida, para correrla después con `skill run`. Usar cuando el trader pide «haceme una skill que calcule…». No para agentes que corren solos ni para estrategias.
---

# Skills con código

Una skill con código es una carpeta (`SKILL.md` + `scripts/*.py`) que se guarda en el espacio de GaleCore del trader, no en la PC ni en el repo. Después se corre igual que las del catálogo: `skill run <clave> <script>`.

Todos los comandos son `python -B -m galecore_ai.adapters.cli skill …`.

## Pedido nuevo: «haceme una skill que calcule…»

1. **Armá la carpeta en el proyecto**: `skills/<nombre>/` con
   - `SKILL.md` con frontmatter `name` y `description` (una frase: qué calcula y cuándo usarla) y el cuerpo corto: qué recibe, qué devuelve.
   - `scripts/<x>.py`: trae los datos con `from galecore_ai import data` y `data.get("<capacidad>", symbol=…)` (las capacidades salen de `galecore list`); imprime **un JSON** por stdout. Si faltan datos o GaleCore no responde, el JSON lo dice (`"estado": "sin evaluar"` y qué falta); nunca inventa ni completa un número.
   - Opcional: `references/*` (notas) y `assets/*` (texto). Sólo se guardan esos archivos, en texto.
   - **Nada de claves ni tokens en los archivos**: el script lee el entorno que ya tiene. Si el guardado dice que parece una clave, sacala.
2. **Probala y guardala de una vez**: `skill save skills/<nombre> --test "<script>.py [args]"`. Si la prueba no sale bien (código distinto de 0 o sin JSON), no se sube: arreglá y repetí. Se sube privada.
3. **Preguntá una sola vez**: «¿La dejo sólo para vos o la compartís con el otro usuario?». Con «compartida», repetí el guardado con `--shared` (misma clave). No lo preguntes de nuevo.
4. Decí en una línea cómo se corre: `skill run <clave> <script>.py [args]`, y qué devuelve.

## Cambiar una que ya existe

`skill pull <clave> skills/<nombre>` baja los archivos (propia o compartida); editá; `skill save skills/<nombre> --key <clave> --test "…"`. Sólo se puede guardar encima de una propia: si la clave era de otro, guardala con otra `--key`.

## Límites

- Hasta ~190.000 caracteres en total; sólo `SKILL.md`, `scripts/*.py`, `references/*`, `assets/*`.
- Los scripts son de lectura: traen datos de GaleCore y calculan. No aprueban, no despliegan, no operan.
