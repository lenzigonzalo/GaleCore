import React, { useEffect, useRef, useState } from 'react';
import { Settings, Shield, User, LogOut } from 'lucide-react';
import type { Tab } from './TabNav';
import { useCurrentUserStore } from '../../store/useCurrentUserStore';
import { NAVIGATION } from './navigation';
export type WorkspaceMode = 'monitor' | 'operativa' | 'lab';
interface Props { active: Tab; mode?: WorkspaceMode; onChange: (tab: Tab) => void; onLogout?: () => void; width?: number; onResize?: (width: number) => void }
export function WorkspaceNav({ active, onChange, onLogout, width, onResize }: Props) {
  const user = useCurrentUserStore(s => s.user);
  const [menu, setMenu] = useState(false);
  const account = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => { if (!account.current?.contains(event.target as Node)) setMenu(false); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenu(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', key); };
  }, [menu]);
  const compact = active === 'lab';
  const drag = (event: React.PointerEvent) => {
    if (!onResize) return; event.preventDefault();
    const move = (e: PointerEvent) => onResize(Math.max(180, Math.min(360, e.clientX)));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  return <aside className={'workspace-navigation' + (compact ? ' compact' : '')} style={!compact && width ? { width } : undefined}>
    <nav aria-label="Navegación del espacio">{NAVIGATION.map(group => <div className="workspace-nav-group" key={group.group}>
      <span className="workspace-group-label">{group.group}</span>{group.entries.map(({ id, label, Icon }) => <button key={id} className="workspace-nav-entry" title={label} aria-label={label} aria-current={active === id ? 'page' : undefined} onClick={() => onChange(id)}><Icon size={19}/><span>{label}</span></button>)}
    </div>)}</nav>
    <div className="workspace-nav-bottom"><button className="workspace-nav-entry" title="Configuración" aria-label="Configuración" onClick={() => onChange('config')}><Settings size={19}/><span>Configuración</span></button>
      <div ref={account} className="workspace-user"><button className="workspace-nav-entry" title={user?.username || 'Usuario'} aria-label="Menú de usuario" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(value => !value)}><User size={19}/><span>{user?.username || 'Usuario'}</span></button>
        {menu && <div className="workspace-user-menu" role="menu">{user?.isAdmin && <button role="menuitem" onClick={() => { setMenu(false); onChange('admin'); }}><Shield size={17}/>Administración</button>}{onLogout && <button role="menuitem" onClick={onLogout}><LogOut size={17}/>Salir</button>}</div>}
      </div>
    </div>
    {!compact && onResize && <div className="workspace-nav-resize" role="separator" aria-orientation="vertical" aria-label="Ancho de la barra lateral" onPointerDown={drag} />}
  </aside>;
}
