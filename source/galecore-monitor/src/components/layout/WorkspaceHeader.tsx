import React from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { Tab } from './TabNav';
import type { WorkspaceMode } from './WorkspaceNav';
import { WorkspaceSearch } from './WorkspaceSearch';
import './WorkspaceChrome.css';
interface Props {
  status?: React.ReactNode; mode?: WorkspaceMode; onModeChange?: (mode: WorkspaceMode) => void;
  active: Tab; onChange: (tab: Tab) => void; onLogout: () => void;
  conversationOpen: boolean; onConversation: () => void; onSymbol: (symbol: string) => Promise<void>;
  sidebarHidden?: boolean; onSidebarToggle?: () => void;
}
export function WorkspaceHeader({ status, mode = 'monitor', onModeChange, onChange, onSymbol, sidebarHidden, onSidebarToggle }: Props) {
  return <header className="workspace-global-header">
    <div className="workspace-global-brand"><button className="workspace-logo" onClick={() => onChange('inicio')}>GaleCore<span>.</span></button>
      <WorkspaceSearch onNavigate={onChange} onSymbol={onSymbol} />
      <button className="workspace-icon-button" aria-label={sidebarHidden ? 'Mostrar barra lateral' : 'Ocultar barra lateral'} title={sidebarHidden ? 'Mostrar barra lateral' : 'Ocultar barra lateral'} onClick={onSidebarToggle}>
        {sidebarHidden ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}</button>
    </div>
    <nav className="workspace-mode-switch" aria-label="Espacios de GaleCore">
      {(['monitor', 'operativa', 'lab'] as const).map(id => <button key={id} aria-pressed={mode === id} onClick={() => onModeChange ? onModeChange(id) : onChange(id === 'monitor' ? 'inicio' : id)}>{id === 'monitor' ? 'Monitor' : id === 'operativa' ? 'Operativa' : 'Lab'}</button>)}
    </nav><div className="workspace-global-status">{status}</div>
  </header>;
}
