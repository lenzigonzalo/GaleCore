import React from 'react';
import { Ban } from 'lucide-react';
import { NoticePanel } from './NoticePanel';

interface Props {
  /** Qué deja de correr, en concreto. Genérico no sirve: el operador tiene que poder confirmar
   *  que lo que apagó es lo que él creía que apagaba. */
  detail: string;
}

/**
 * Lo ÚNICO que se muestra en la pantalla de una estrategia con su switch en OFF.
 *
 * La regla (CLAUDE.md): en OFF la estrategia no hace nada Y su tablero vuelve al estado inicial.
 * Hasta 2026-08-10 las dos pantallas seguían renderizando todo con el último dato, marcado como
 * "congelado" — pero un panel lleno de números se lee como vigente aunque diga que no lo está, y
 * ese fue el patrón de bugs que apareció todo ese día: valores plausibles que nadie confronta.
 *
 * Cortar el árbol acá también apaga actividad real, no solo píxeles: los efectos que suscriben al
 * hub viven dentro de los componentes que dejan de montarse.
 *
 * El formato lo pone `NoticePanel`, que comparte con el cartel del Monitor sin cuenta vinculada:
 * son el mismo "acá no hay nada y este es el motivo" por dos causas distintas.
 */
export function StrategyOffPanel({ detail }: Props) {
  return (
    <NoticePanel
      color="var(--red-gc)"
      icon={<Ban size={20} />}
      title="Estrategia apagada"
      detail={detail}
      hint="Prendé el switch de arriba para volver a levantarla."
    />
  );
}
