import React from 'react';
import type { StrategyCard } from '../../types/shadow';
import { tidyReason } from './discardPresentation';

/** Por qué la estrategia no abre posiciones, en una línea al tope del Registro. Lo calcula la API (en la tarjeta); acá se muestra tal cual. */
export function WhyNotOperating({ card }: { card: StrategyCard | null }) {
  const stall = card?.stall;
  if (!stall) return null;
  const text = stall.text.charAt(0).toUpperCase() + stall.text.slice(1);
  return <p className="why-not" role="status"><strong>{text}</strong>{stall.reason && <> · {tidyReason(stall.reason)}</>}</p>;
}
