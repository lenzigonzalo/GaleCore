import React from 'react';
import { Engine, PERMISSION_MODES } from './chatPermissions';

/** Selector de los permisos con los que arranca cada chat de un motor (Configuración → Proveedores de IA y Chat). */
export function PermissionModeSelect({ engine, value, onChange }: { engine: Engine; value: string; onChange: (mode: string) => void }) {
  return <select aria-label={'Permisos iniciales de ' + (engine === 'claude' ? 'Claude Code' : 'Codex')} value={value} onChange={e => onChange(e.target.value)}>
    {PERMISSION_MODES[engine].map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
  </select>;
}
