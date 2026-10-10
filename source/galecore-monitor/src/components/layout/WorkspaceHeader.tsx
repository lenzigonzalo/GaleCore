import React from 'react';
import { MessageSquare } from 'lucide-react';
import type { Tab } from './TabNav';
import type { WorkspaceMode } from './WorkspaceNav';
import { WorkspaceSearch } from './WorkspaceSearch';
import { AccountMenu } from './AccountMenu';

interface Props {
  mainDemo?: boolean;
  mode?: WorkspaceMode; onModeChange?: (mode: WorkspaceMode) => void;
  active: Tab; onChange: (tab: Tab) => void; onLogout: () => void;
  conversationOpen: boolean; onConversation: () => void;
  onSymbol: (symbol: string) => Promise<void>;
}
const PAGES: Record<Tab, string> = {
  inicio: 'Resumen', operativa: 'Mesa de operación', lab: 'Espacio de trabajo',
  monitor: 'Cartera', gex: 'Mercado', estrategias: 'Estrategias', rpf: 'Seguimiento RPF',
  shadow: 'Seguimiento SHADOW', inteligencia: 'Biblioteca', agentes: 'Agentes y tareas',
  config: 'Configuración', admin: 'Administración',
};
export function WorkspaceHeader({ mainDemo = false, mode = 'monitor', onModeChange, active, onChange, onLogout, conversationOpen, onConversation, onSymbol }: Props) {
  return <>
    <div className={'workspace-mode-bar' + (mainDemo ? ' workspace-mode-bar-compact' : '')}>
      <span className="workspace-mode-caption">{mode === 'monitor' ? 'Comprender' : mode === 'operativa' ? 'Gestionar' : 'Investigar y crear'}</span>
      <nav className="workspace-mode-switch" aria-label="Espacios de GaleCore">
        {(['monitor', 'operativa', 'lab'] as const).map(id => <button key={id} aria-pressed={mode === id} onClick={() => onModeChange ? onModeChange(id) : onChange(id === 'monitor' ? 'inicio' : id)}>{id === 'monitor' ? 'Monitor' : id === 'operativa' ? 'Operativa' : 'Lab'}</button>)}
      </nav>
      {mainDemo ? <button className="wd-demo-user" onClick={() => onChange('config')}><span>GC</span>Trader demo</button> : <AccountMenu onOpenSettings={() => onChange('config')} onLogout={onLogout} active={active === 'config'} />}
    </div>
    {!(mode === 'lab' && ['lab', 'estrategias'].includes(active)) && !(mainDemo && ['inicio', 'monitor', 'gex', 'config', 'admin'].includes(active)) && <header className="workspace-heading">
      <div><h1>{PAGES[active]}</h1></div>
      {mainDemo ? <span className="wd-header-context">USD · Cuenta demo 01</span> : <WorkspaceSearch onNavigate={onChange} onSymbol={onSymbol} />}
      <button className="workspace-conversation" aria-label="Abrir Lab real"
        aria-pressed={conversationOpen} onClick={onConversation}><MessageSquare size={18} /><span>Lab</span></button>
    </header>}
  </>;
}
