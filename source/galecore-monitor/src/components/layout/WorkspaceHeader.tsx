import React from 'react';
import { MessageSquare } from 'lucide-react';
import type { Tab } from './TabNav';
import { WorkspaceSearch } from './WorkspaceSearch';
import { AccountMenu } from './AccountMenu';
import { useAccountStore } from '../../store/useAccountStore';
import { fmtCurrency, fmtTime, isStale } from '../../utils/formatters';

interface Props {
  mainDemo?: boolean;
  active: Tab; onChange: (tab: Tab) => void; onLogout: () => void;
  conversationOpen: boolean; onConversation: () => void;
  onSymbol: (symbol: string) => Promise<void>;
}
const PAGES: Record<Tab, { title: string; detail: string }> = {
  lab: { title: 'Lab', detail: '' },
  inicio: { title: 'Main', detail: 'Cuenta real, posiciones y patrimonio' },
  monitor: { title: 'Cartera', detail: 'Lectura de cuenta y posiciones' },
  gex: { title: 'Mercado', detail: 'Análisis por instrumento · GEX' },
  estrategias: { title: 'Estrategias', detail: 'Catálogo y controles existentes' },
  rpf: { title: 'Estrategias / RPF', detail: 'Sugerencias · sin ejecución de órdenes' },
  shadow: { title: 'Lab / Ejecuciones SHADOW', detail: 'Datos reales · ejecución simulada' },
  inteligencia: { title: 'Biblioteca', detail: 'Registros de régimen e informes disponibles' },
  agentes: { title: 'Agentes', detail: 'Tareas y resultados publicados' },
  config: { title: 'Configuración', detail: 'Cuenta, perfil, métodos y conexiones actuales' },
  admin: { title: 'Administración', detail: 'Controles de plataforma' },
};
export function WorkspaceHeader({ mainDemo = false, active, onChange, onLogout, conversationOpen, onConversation, onSymbol }: Props) {
  const { balances, errorBalances, loadingBalances, lastUpdate } = useAccountStore();
  if (mainDemo) return null;
  const page = PAGES[active];
  const strategySection = ['lab', 'estrategias', 'rpf', 'shadow'].includes(active);
  const workSection = strategySection || active === 'agentes';
  return (
    <>
      <header className="workspace-heading">
        <div><h1>{page.title}</h1></div>
        {mainDemo ? <div className="main-demo-header-context">Vista de diseño · datos ficticios</div> : <WorkspaceSearch onNavigate={onChange} onSymbol={onSymbol} />}
        <div className="workspace-heading-actions">
          {!workSection && !mainDemo && <button className="workspace-account" onClick={() => onChange('monitor')} title="Abrir Cartera">
            <span>{lastUpdate ? (isStale(lastUpdate) ? 'Lectura anterior · ' : 'Cuenta · ') + fmtTime(lastUpdate) + ' ET' : 'Cuenta · sin fecha'}</span><strong>{loadingBalances ? 'Leyendo…' : errorBalances || !balances ? 'Sin lectura' : fmtCurrency(balances.netLiquidatingValue)}</strong>
          </button>}
          <button className="workspace-conversation" aria-label={conversationOpen ? 'Ocultar conversación' : 'Abrir conversación'}
            aria-pressed={conversationOpen} onClick={onConversation}><MessageSquare size={18} /><span>Conversación</span></button>
          {<AccountMenu onOpenSettings={() => onChange('config')} onLogout={onLogout} active={active === 'config'} />}
        </div>
      </header>
      {strategySection && <nav className="workspace-object-nav" aria-label="Vistas del Lab">
        {([['lab', 'Resumen'], ['estrategias', 'Estrategias'], ['shadow', 'Ejecuciones SHADOW']] as const).map(([id, label]) => (
          <button key={id} aria-current={active === id ? 'page' : undefined} onClick={() => onChange(id)}>{label}</button>
        ))}
      </nav>}
    </>
  );
}
