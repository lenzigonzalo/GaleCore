import React, { useEffect, useState } from 'react';
import { fetchShadowDiscards } from '../../api/shadow';
import { ShadowEvent } from '../../types/shadow';
import { BLOCKING_EVENT_TYPES, whyNotOperating, whyNotText } from './ficha';

/** El titular de la ficha: por qué la estrategia no abre posiciones, sin abrir ninguna pestaña. */
export function WhyNotOperating({ instanceId, openPositions }: { instanceId?: string; openPositions: number | null }) {
  const [events, setEvents] = useState<ShadowEvent[] | null>(null);
  useEffect(() => {
    let active = true; setEvents(null);
    if (instanceId) Promise.resolve().then(() => fetchShadowDiscards(instanceId, 500, [...BLOCKING_EVENT_TYPES, 'POSITION_OPENED']))
      .then(list => { if (active) setEvents(list); }).catch(() => undefined);
    return () => { active = false; };
  }, [instanceId]);
  const why = events && openPositions !== null ? whyNotOperating(events, openPositions) : null;
  if (!why) return null;
  return <div className="why-not" role="status"><strong>{whyNotText(why)}</strong>{why.reason && <p>{why.reason}</p>}</div>;
}
