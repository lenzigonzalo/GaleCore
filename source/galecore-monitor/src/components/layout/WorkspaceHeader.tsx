import React from 'react';
import { PanelLeftClose, PanelLeftOpen, PanelRight } from 'lucide-react';
import type { Tab } from './TabNav';
import { WorkspaceSearch } from './WorkspaceSearch';
import './WorkspaceChrome.css';
interface Props { status?: React.ReactNode; active: Tab; onChange: (tab: Tab) => void; onLogout: () => void; conversationOpen: boolean; onConversation: () => void; onSymbol: (symbol: string) => Promise<void>; navHidden?: boolean; onNavToggle?: () => void }
export function WorkspaceHeader({ status, active, onChange, onSymbol, conversationOpen, onConversation, navHidden = false, onNavToggle }: Props) {
  return <header className="workspace-global-header"><div className="workspace-global-brand"><button className="workspace-logo" onClick={() => onChange('inicio')}>GaleCore<span>.</span></button><WorkspaceSearch onNavigate={onChange} onSymbol={onSymbol}/>{onNavToggle && <button className="workspace-nav-toggle" aria-label={navHidden ? 'Mostrar barra lateral' : 'Ocultar barra lateral'} title={navHidden ? 'Mostrar barra lateral' : 'Ocultar barra lateral'} onClick={onNavToggle}>{navHidden ? <PanelLeftOpen size={18}/> : <PanelLeftClose size={18}/>}</button>}</div>
    <div className="workspace-header-right"><div className="workspace-global-status">{status}</div>{active !== 'lab' && <button className="workspace-chat-toggle" aria-pressed={conversationOpen} aria-label={conversationOpen ? 'Ocultar chat dividido' : 'Abrir chat dividido'} title="Chat en pantalla dividida" onClick={onConversation}><PanelRight size={20}/><span>Chat dividido</span></button>}</div>
  </header>;
}
