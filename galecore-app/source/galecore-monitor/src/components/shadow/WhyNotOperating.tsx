import React, { useEffect, useState } from 'react';
import { fetchStrategyCard } from '../../api/shadow';
import type { StrategyCard } from '../../types/shadow';

/** El titular de la ficha: por qué la estrategia no abre posiciones, sin abrir ninguna pestaña. Lo calcula la API; acá se muestra tal cual. */
export function WhyNotOperating({ spec }: { spec: string }) {
  const [stall, setStall] = useState<StrategyCard['stall']>(null);
  useEffect(() => {
    let active = true; setStall(null);
    Promise.resolve().then(() => fetchStrategyCard(spec)).then(card => { if (active) setStall(card.stall ?? null); }).catch(() => undefined);
    return () => { active = false; };
  }, [spec]);
  if (!stall) return null;
  const text = stall.text.charAt(0).toUpperCase() + stall.text.slice(1);
  return <div className="why-not" role="status"><strong>{text}</strong>{stall.reason && <p>{stall.reason}</p>}</div>;
}
