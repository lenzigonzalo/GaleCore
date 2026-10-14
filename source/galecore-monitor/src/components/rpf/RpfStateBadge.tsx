import React from 'react';
import { RpfStateName } from '../../types/rpf';
import { tint } from '../../utils/formatters';

// Semántica de color de los 7 estados (diseño Fase 5 §4).
const STATE_META: Record<RpfStateName, { color: string; label: string; hint: string }> = {
  VETOED:           { color: 'var(--red-gc)',   label: 'VETADO',     hint: 'peligro de cola activo (tail ≥ 2)' },
  WAITING_CAPACITY: { color: 'var(--yellow-gc)', label: 'SIN CUPO',   hint: 'trade que cruza la barra, libro lleno' },
  IN_POSITION:      { color: 'var(--blue-gc)',  label: 'EN POSICIÓN', hint: 'libro lleno, solo gestión' },
  DORMANT:          { color: 'var(--text-muted)', label: 'DORMIDO',   hint: 'sin peligro pero sin setup' },
  ARMED:            { color: 'var(--text-secondary)',         label: 'ARMADO',      hint: 'entorno OK, se vigila el edge' },
  COOLDOWN:         { color: 'var(--text-secondary)',         label: 'ENFRIANDO',   hint: 'suprime re-disparo tras ack/TTL' },
  TRIGGERED:        { color: 'var(--green)',    label: 'DISPARADO',   hint: 'sugerencia emitida' },
};

export function RpfStateBadge({ state, size = 'md' }: { state: RpfStateName; size?: 'sm' | 'md' }) {
  const meta = STATE_META[state] ?? STATE_META.DORMANT;
  const fs = size === 'sm' ? 10 : 12;
  return (
    <span
      title={meta.hint}
      style={{
        fontSize: fs, fontWeight: 700, letterSpacing: '0.07em', padding: size === 'sm' ? '2px 7px' : '4px 12px',
        borderRadius: 5, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap',
        color: meta.color, backgroundColor: tint(meta.color, 13), border: `1px solid ${tint(meta.color, 33)}`,
      }}
    >
      {meta.label}
    </span>
  );
}

export function rpfStateHint(state: RpfStateName): string {
  return (STATE_META[state] ?? STATE_META.DORMANT).hint;
}
