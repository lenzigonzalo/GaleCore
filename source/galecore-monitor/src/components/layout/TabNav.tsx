import React from 'react';
import { DESTINATIONS } from './navigation';
export type Tab = 'operativa' | 'lab' | 'estrategias' | 'inicio' | 'monitor' | 'rpf' | 'gex' | 'macro' | 'shadow' | 'inteligencia' | 'agentes' | 'admin' | 'config';
export function TabNav({ active, onChange }: { active: Tab; onChange: (tab: Tab) => void; onLogout?: () => void }) {
  return <nav aria-label="Pantallas">{DESTINATIONS.map(({ id, label, Icon }) => <button key={id} aria-current={active === id ? 'page' : undefined} onClick={() => onChange(id)}><Icon size={18}/>{label}</button>)}</nav>;
}
