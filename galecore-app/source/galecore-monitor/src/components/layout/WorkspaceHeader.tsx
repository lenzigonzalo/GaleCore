import React from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { Tab } from './TabNav';
import { WorkspaceSearch } from './WorkspaceSearch';
import './WorkspaceChrome.css';
interface Props { status?: React.ReactNode; active: Tab; onChange: (tab: Tab) => void; onLogout: () => void; onSymbol: (symbol: string) => Promise<void>; navHidden?: boolean; onNavToggle?: () => void }
export function WorkspaceHeader({ status, active, onChange, onSymbol, navHidden = false, onNavToggle }: Props) {
  return <header className={'workspace-global-header' + (active === 'gex' ? ' workspace-market-header' : '')}><div className="workspace-global-brand"><button className="workspace-logo" onClick={() => onChange('inicio')}><img className="workspace-brand-mark" src={`${process.env.PUBLIC_URL}/galecore-mark.png`} alt="" width={28} height={28}/><span className="workspace-brand-name">GaleCore<span>.</span></span></button>{active !== 'gex' && <WorkspaceSearch onNavigate={onChange} onSymbol={onSymbol}/>} {onNavToggle && <button className="workspace-nav-toggle" aria-label={navHidden ? 'Mostrar barra lateral' : 'Ocultar barra lateral'} title={navHidden ? 'Mostrar barra lateral' : 'Ocultar barra lateral'} onClick={onNavToggle}>{navHidden ? <PanelLeftOpen size={18}/> : <PanelLeftClose size={18}/>}</button>}</div>
    <div id="workspace-header-slot" className="workspace-header-slot">{active === 'gex' && <WorkspaceSearch expanded onNavigate={onChange} onSymbol={onSymbol}/>}</div>
    <div className="workspace-header-right"><div className="workspace-global-status">{status}</div></div>
  </header>;
}
