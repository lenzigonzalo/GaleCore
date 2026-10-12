import React, { useEffect, useRef, useState } from 'react';
import { LayoutDashboard, Activity, Zap, BarChart3, Shield, FlaskConical, Brain, Bot, Layers, ChevronDown } from 'lucide-react';
import { AccountMenu } from './AccountMenu';
import { useCurrentUserStore } from '../../store/useCurrentUserStore';

// Los ids de las pestañas de estrategia ('rpf', 'gex') son los que declara `tab` en strategies[]
// del config de la app: las cards de Main navegan por ese valor.
//
// 'config' es una pestaña sin botón en la barra: Configuración (GC-0007), desde el menú de la cuenta.
export type Tab = 'operativa' | 'lab' | 'estrategias' | 'inicio' | 'monitor' | 'rpf' | 'gex' | 'macro' | 'shadow' | 'inteligencia' | 'agentes' | 'admin' | 'config';

interface Props {
  active: Tab;
  onChange: (tab: Tab) => void;
  onLogout?: () => void;
}

// References dejó de ser pestaña: cada estrategia tiene su botón "References" en la cabecera de su
// pantalla, que abre un modal con Definiciones + JSON de reglas.
//
type TabDef = { id: Tab; label: string; Icon: React.ComponentType<{ size?: number }> };

// Las pestañas del tablero, de izquierda a derecha (GC-0009): Main, Monitor, el menú Estrategias,
// Inteligencia y Agentes.
const LEADING: TabDef[] = [
  { id: 'inicio',          label: 'Main',              Icon: LayoutDashboard },
  { id: 'monitor',         label: 'Monitor',           Icon: Activity        },
];

// Estrategias es un menú y no tres botones: la barra crece con cada estrategia y lo que se mira
// todo el día (Main, Monitor, Agentes) no tiene que correrse por eso. SHADOW va adentro aunque
// no sea una estrategia (es el runtime que simula las que diseña GaleCore-AI): es donde se las mira.
const STRATEGY_TABS: TabDef[] = [
  { id: 'gex',             label: 'GEX',               Icon: BarChart3       },
  { id: 'rpf',             label: 'RPF',               Icon: Zap             },
  { id: 'shadow',          label: 'SHADOW',            Icon: FlaskConical    },
];

// Inteligencia: lo que la IA interpretó y cómo se evaluó. Agentes: lo que corre solo con las
// instrucciones del trader (GC-0009).
const TRAILING: TabDef[] = [
  { id: 'inteligencia',    label: 'Inteligencia',      Icon: Brain           },
  { id: 'agentes',         label: 'Agentes',           Icon: Bot             },
];

// Admin va a la DERECHA, pegada a Mi Cuenta, y no con las del tablero: no es una pantalla de
// trabajo —no se mira mientras se opera— sino administración, del mismo lado que lo demás que no
// es mercado.
//
// Es SOLO PARA ADMIN. Se le mostraba a todos mientras adentro vivía la cuenta de bróker de cada
// uno; con esa card mudada al menú Mi Cuenta, lo único que queda ahí es la tabla de usuarios, que
// administra a OTROS. Mientras no se sepa el rol no se muestra: fallar hacia "no puede" es lo
// correcto para un permiso. El gate real sigue siendo el 403 del endpoint.
const ADMIN_TAB = { id: 'admin' as Tab, label: 'Admin', Icon: Shield };

const tabStyle = (isActive: boolean): React.CSSProperties => ({
  color: isActive ? 'var(--bg-primary)' : 'var(--text-secondary)',
  background: isActive ? 'var(--text-primary)' : 'none',
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
  fontWeight: isActive ? 600 : 400,
  borderRadius: 9,
  height: 40,
  whiteSpace: 'nowrap',
});

/** El menú Estrategias: se marca como pestaña activa cuando la pantalla abierta es una de las suyas. */
function StrategiesMenu({ active, onChange }: { active: Tab; onChange: (tab: Tab) => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const current = STRATEGY_TABS.find((t) => t.id === active);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'flex', alignItems: 'center', height: '100%' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 px-4 text-xs tracking-wide"
        style={tabStyle(!!current)}
      >
        <Layers size={14} />
        {current ? `Estrategias · ${current.label}` : 'Estrategias'}
        <ChevronDown size={12} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 120ms' }} />
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', top: '100%', left: 0, zIndex: 900, marginTop: 1, minWidth: 180, padding: '5px 0',
            backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8,
            boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
          }}
        >
          {STRATEGY_TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              role="menuitem"
              onClick={() => { setOpen(false); onChange(id); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '8px 12px', border: 'none',
                cursor: 'pointer', fontSize: 13.5, fontFamily: 'var(--font-sans)', textAlign: 'left', whiteSpace: 'nowrap',
                background: id === active ? 'var(--bg-tertiary)' : 'none',
                color: id === active ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: id === active ? 600 : 400,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = id === active ? 'var(--bg-tertiary)' : 'transparent'; }}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TabNav({ active, onChange, onLogout }: Props) {
  const isAdmin = useCurrentUserStore((s) => s.user?.isAdmin ?? false);

  const renderTab = ({ id, label, Icon }: TabDef) => {
    const isActive = id === active;
    return (
      <button
        key={id}
        onClick={() => onChange(id)}
        className="flex items-center gap-1.5 px-4 h-full text-xs tracking-wide transition-colors relative"
        style={tabStyle(isActive)}
      >
        <Icon size={14} />
        {label}
      </button>
    );
  };

  return (
    <nav
      className="dashboard-nav flex items-center shrink-0 gap-1"
      style={{
        backgroundColor: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border-dark)',
        paddingLeft: 8,
        paddingRight: 12,
        height: 60,
      }}
    >
      {LEADING.map(renderTab)}
      <StrategiesMenu active={active} onChange={onChange} />
      {TRAILING.map(renderTab)}

      {/* Grupo de la derecha: administración y lo de cada operador. */}
      <div className="flex items-center" style={{ marginLeft: 'auto', height: '100%' }}>
        {isAdmin && renderTab(ADMIN_TAB)}
        <AccountMenu
          onOpenSettings={() => onChange('config')}
          onLogout={onLogout}
          active={active === 'config'}
        />
      </div>
    </nav>
  );
}
