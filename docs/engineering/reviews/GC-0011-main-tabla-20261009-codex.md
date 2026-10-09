# GC-0011 — revisión independiente del ajuste Main

09/10/2026. Reviewer separado: review_main, gpt-5.6-sol, esfuerzo alto.
Alcance: diff no commiteado sobre db29e63a, exclusivamente Main.tsx e index.css.
Dictamen: APPROVE con P3 no bloqueante. Revisión estática de una pasada, sin rechecks ni QA visual.

P3: la acción por posición sólo con icono de unos 32 px reduce descubribilidad/tamaño táctil.
Implementer agrega texto «Ver» y min-height/min-width 44 px; no se infiere recheck del reviewer.

El reviewer no encontró pérdida/reinterpretación de datos. Tabla preserva instrumento, símbolo,
cantidad, dirección y precio; nota global de falta de vínculo. Details SHADOW nativo conserva datos,
estados parciales y navegación. Scroll horizontal sin anchos fijos problemáticos.

Pendiente: observación en navegador con datos reales, envoltura y scroll/tamaño táctil.
Esta revisión no cierra GC-0011 ni reemplaza el review de la exploración integral.
