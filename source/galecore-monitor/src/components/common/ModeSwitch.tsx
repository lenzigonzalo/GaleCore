import React from 'react';

/** Interruptor Auto | Manual de una estrategia (WS-0036). El mismo en toda la app. */
export function ModeSwitch({ mode, onChange, autoBlocked, busy }: {
  mode: 'AUTO' | 'MANUAL'; onChange: (mode: 'AUTO' | 'MANUAL') => void; autoBlocked?: string; busy?: boolean;
}) {
  const option = (value: 'AUTO' | 'MANUAL', label: string, blocked?: string) => (
    <button type="button" role="radio" aria-checked={mode === value} disabled={busy || !!blocked}
      title={blocked || (value === 'AUTO' ? 'Corre sola' : 'Avisa y vos decidís')}
      onClick={event => { event.stopPropagation(); if (mode !== value) onChange(value); }}>{label}</button>
  );
  return <span className="mode-switch" role="radiogroup" aria-label="Modo" onClick={event => event.stopPropagation()}>
    {option('AUTO', 'Auto', autoBlocked)}{option('MANUAL', 'Manual')}
  </span>;
}
