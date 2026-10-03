import React from 'react';
import { LayoutDashboard, Activity, Zap, BarChart3, Shield, FlaskConical, Brain } from 'lucide-react';
import { AccountMenu } from './AccountMenu';
import { useCurrentUserStore } from '../../store/useCurrentUserStore';

// Los ids de las pestañas de estrategia ('rpf', 'gex') son los que declara `tab` en strategies[]
// del config de la app: las cards de Main navegan por ese valor.
//
// 'cuenta' es una pestaña sin botón en la barra: se llega desde el menú Mi Cuenta.
export type Tab = 'inicio' | 'monitor' | 'rpf' | 'gex' | 'shadow' | 'inteligencia' | 'admin' | 'cuenta';

interface Props {
  active: Tab;
  onChange: (tab: Tab) => void;
  onLogout?: () => void;
}

// References dejó de ser pestaña: cada estrategia tiene su botón "References" en la cabecera de su
// pantalla, que abre un modal con Definiciones + JSON de reglas.
//
// Las pestañas del tablero, de izquierda a derecha.
const TABS: { id: Tab; label: string; Icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'inicio',          label: 'Main',              Icon: LayoutDashboard },
  { id: 'monitor',         label: 'Monitor',           Icon: Activity        },
  { id: 'gex',             label: 'GEX',               Icon: BarChart3       },
  { id: 'rpf',             label: 'RPF',               Icon: Zap             },
  // Runtime SHADOW (GC-0004): simulación con datos reales, no es una estrategia.
  { id: 'shadow',          label: 'SHADOW',            Icon: FlaskConical    },
  // Inteligencia va después de las estrategias: no es mercado en vivo sino lo que la IA interpretó
  // y cómo se evaluó después (registros de régimen, review humano).
  { id: 'inteligencia',    label: 'Inteligencia',      Icon: Brain           },
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

export function TabNav({ active, onChange, onLogout }: Props) {
  const isAdmin = useCurrentUserStore((s) => s.user?.isAdmin ?? false);

  const renderTab = ({ id, label, Icon }: { id: Tab; label: string; Icon: React.ComponentType<{ size?: number }> }) => {
    const isActive = id === active;
    return (
      <button
        key={id}
        onClick={() => onChange(id)}
        className="flex items-center gap-1.5 px-4 h-full text-xs uppercase tracking-wider transition-colors relative"
        style={{
          color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontFamily: 'Inter, sans-serif',
          fontWeight: isActive ? 600 : 400,
          borderBottom: isActive ? '2px solid var(--blue-gc)' : '2px solid transparent',
          whiteSpace: 'nowrap',
        }}
      >
        <Icon size={12} />
        {label}
      </button>
    );
  };

  return (
    <nav
      className="flex items-center shrink-0"
      style={{
        backgroundColor: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border-dark)',
        paddingLeft: 8,
        paddingRight: 12,
        height: 36,
      }}
    >
      {TABS.map(renderTab)}

      {/* Grupo de la derecha: administración y lo de cada operador. */}
      <div className="flex items-center" style={{ marginLeft: 'auto', height: '100%' }}>
        {isAdmin && renderTab(ADMIN_TAB)}
        <AccountMenu
          onOpenBrokerAccount={() => onChange('cuenta')}
          onLogout={onLogout}
          active={active === 'cuenta'}
        />
      </div>
    </nav>
  );
}
