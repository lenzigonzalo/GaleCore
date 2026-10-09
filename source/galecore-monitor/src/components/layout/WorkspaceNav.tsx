import React, { useState } from 'react';
import { LayoutDashboard, FlaskConical, ChartNoAxesCombined, Wallet, Layers, Bot, BookOpen, Settings, Shield, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { Tab } from './TabNav';
import { useCurrentUserStore } from '../../store/useCurrentUserStore';

interface Props { active: Tab; onChange: (tab: Tab) => void }

/** Navegación por intención; las vistas operacionales conservan sus identidades. */
export function WorkspaceNav({ active, onChange }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const isAdmin = useCurrentUserStore(s => s.user?.isAdmin ?? false);
  const selected = active === 'gex' ? 'gex' : active === 'shadow' ? 'lab' : active === 'rpf' ? 'estrategias' : active;
  const entry = (id: Tab, label: string, Icon: React.ComponentType<{ size?: number }>) => (
    <button key={id} className="workspace-nav-entry" title={label} aria-label={label}
      aria-current={selected === id ? 'page' : undefined} onClick={() => onChange(id)}>
      <Icon size={19} /><span>{label}</span>
    </button>
  );
  return (
    <aside className={'workspace-navigation' + (collapsed ? ' collapsed' : '')}>
      <button className="workspace-brand" onClick={() => onChange('inicio')} aria-label="GaleCore · Main" title="GaleCore · Main">
        <span className="workspace-wordmark">GaleCore</span>
      </button>
      <nav aria-label="Navegación principal">
        <div className="workspace-nav-group"><span className="workspace-group-label">Gestión</span>
          {entry('inicio', 'Main', LayoutDashboard)}
          {entry('monitor', 'Cartera', Wallet)}
        </div>
        <div className="workspace-nav-group"><span className="workspace-group-label">Trabajo</span>
          {entry('lab', 'Lab', FlaskConical)}
          {entry('estrategias', 'Estrategias', Layers)}
          {entry('agentes', 'Agentes', Bot)}
        </div>
        <div className="workspace-nav-group"><span className="workspace-group-label">Compartido</span>
          {entry('gex', 'Mercado', ChartNoAxesCombined)}
          {entry('inteligencia', 'Biblioteca', BookOpen)}
        </div>
      </nav>
      <div className="workspace-nav-bottom">
        {entry('config', 'Configuración', Settings)}
        {isAdmin && entry('admin', 'Administración', Shield)}
        <button className="workspace-nav-entry workspace-collapse" aria-label={collapsed ? 'Expandir navegación' : 'Contraer navegación'}
          title={collapsed ? 'Expandir navegación' : 'Contraer navegación'} onClick={() => setCollapsed(v => !v)}>
          {collapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}<span>Contraer</span>
        </button>
      </div>
    </aside>
  );
}
