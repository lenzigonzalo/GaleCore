import React from 'react';
import { ArrowUpRight } from 'lucide-react';

const STAGES: Record<string, string> = { LIVE: 'Live', PAPER: 'Paper', SHADOW: 'SHADOW' };
const MODES: Record<string, string> = { AUTO: 'Auto', MANUAL: 'Manual' };

/** Etapa y modo en una etiqueta: «SHADOW · Auto», «Live · Manual» (WS-0036). */
export function StageModeChip({ stage, mode }: { stage?: string; mode?: string }) {
  if (!stage) return null;
  return <span className="instance-state stage-chip">{STAGES[stage] ?? stage}{mode ? ` · ${MODES[mode] ?? mode}` : ''}</span>;
}

/**
 * Encabezado común de toda estrategia, sea Live o SHADOW (owner, 14/10: «ver todo consistente»): en un renglón la
 * ruta, el nombre y sus etiquetas; a la derecha lo que se puede hacer.
 */
export function StrategyHeader({ title, hint, chips, onBack, onOpenChat, actions }: {
  title: string; hint?: string; chips?: React.ReactNode; onBack?: () => void; onOpenChat?: () => void; actions?: React.ReactNode;
}) {
  return <header className="strategy-header">
    <div className="strategy-header-title">
      {onBack && <><button className="strategy-crumb" onClick={onBack}>Estrategias</button><span className="strategy-crumb-sep" aria-hidden="true">›</span></>}
      <h2 title={hint}>{title}</h2>{chips}
    </div>
    <div className="strategy-header-actions">{actions}{onOpenChat && <button className="strategy-header-link" onClick={onOpenChat}>Abrir en el chat<ArrowUpRight size={15}/></button>}</div>
  </header>;
}
