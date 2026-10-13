import React from 'react';
import { LayoutDashboard, FlaskConical, ChartNoAxesCombined, Wallet, Layers, Bot, BookOpen, Settings, Shield, Activity, MessageSquare, Globe, LogOut } from 'lucide-react';
import type { Tab } from './TabNav';
import { useCurrentUserStore } from '../../store/useCurrentUserStore';

export type WorkspaceMode = 'monitor' | 'operativa' | 'lab';
interface Props { active: Tab; mode?: WorkspaceMode; onChange: (tab: Tab) => void; onLogout?: () => void }

export function WorkspaceNav({ active, mode = 'monitor', onChange, onLogout }: Props) {
  const isAdmin = useCurrentUserStore(s => s.user?.isAdmin ?? false);
  const entry = (id: Tab, label: string, Icon: React.ComponentType<{ size?: number }>) => (
    <button key={id} className="workspace-nav-entry" title={label} aria-label={label}
      aria-current={active === id ? 'page' : undefined} onClick={() => onChange(id)}>
      <Icon size={19} /><span>{label}</span>
    </button>
  );
  return (
    <aside className="workspace-navigation">
      <nav aria-label="Navegación del espacio">
        <div className="workspace-nav-group"><span className="workspace-group-label">{mode === 'monitor' ? 'Tu panorama' : mode === 'operativa' ? 'Tu operativa' : 'Tu espacio de trabajo'}</span>
          {mode === 'monitor' && <>{entry('inicio', 'Resumen', LayoutDashboard)}{entry('monitor', 'Cartera', Wallet)}{entry('gex', 'Mercado', ChartNoAxesCombined)}{entry('macro', 'Macro', Globe)}</>}
          {mode === 'operativa' && <>{entry('operativa', 'Mesa de operación', Activity)}{entry('monitor', 'Posiciones', Wallet)}{entry('estrategias', 'Estrategias', Layers)}{entry('rpf', 'Seguimiento RPF', ChartNoAxesCombined)}</>}
          {mode === 'lab' && <>{entry('lab', 'Espacio de trabajo', MessageSquare)}{entry('estrategias', 'Proyectos de estrategia', Layers)}{entry('shadow', 'Seguimiento SHADOW', FlaskConical)}{entry('agentes', 'Agentes y tareas', Bot)}</>}
        </div>
        <div className="workspace-nav-group"><span className="workspace-group-label">Compartido</span>
          {entry('inteligencia', 'Biblioteca', BookOpen)}
          {mode !== 'monitor' && entry('gex', 'Mercado', ChartNoAxesCombined)}
        </div>
      </nav>
      <div className="workspace-nav-bottom">
        {entry('config', 'Configuración', Settings)}
        {onLogout && <button className="workspace-nav-entry" onClick={onLogout}><LogOut size={19}/><span>Salir</span></button>}
        {isAdmin && entry('admin', 'Administración', Shield)}

      </div>
    </aside>
  );
}
