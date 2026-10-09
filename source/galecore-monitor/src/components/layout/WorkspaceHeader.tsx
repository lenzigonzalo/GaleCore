import React from 'react';
import { MessageSquare } from 'lucide-react';
import type { Tab } from './TabNav';
import { AccountMenu } from './AccountMenu';
import { useAccountStore } from '../../store/useAccountStore';
import { fmtCurrency, fmtTime, isStale } from '../../utils/formatters';

interface Props {
  active: Tab; onChange: (tab: Tab) => void; onLogout: () => void;
  conversationOpen: boolean; onConversation: () => void;
  preview?: boolean;
}
const PAGES: Record<Tab, { title: string; detail: string }> = {
  inicio: { title: 'Hoy', detail: 'Últimas revisiones y trabajos disponibles' },
  monitor: { title: 'Cartera', detail: 'Lectura de cuenta y posiciones' },
  gex: { title: 'Mercado', detail: 'Análisis por instrumento · GEX' },
  estrategias: { title: 'Estrategias', detail: 'Catálogo y controles existentes' },
  rpf: { title: 'Estrategias / RPF', detail: 'Sugerencias · sin ejecución de órdenes' },
  shadow: { title: 'Estrategias / SHADOW', detail: 'Datos reales · ejecución simulada' },
  inteligencia: { title: 'Biblioteca', detail: 'Registros de régimen e informes disponibles' },
  agentes: { title: 'Agentes', detail: 'Tareas y resultados publicados' },
  config: { title: 'Configuración', detail: 'Cuenta, perfil, métodos y conexiones actuales' },
  admin: { title: 'Administración', detail: 'Controles de plataforma' },
};
export function WorkspaceHeader({ active, onChange, onLogout, conversationOpen, onConversation, preview = false }: Props) {
  const { balances, errorBalances, loadingBalances, lastUpdate } = useAccountStore();
  const page = PAGES[active];
  const strategySection = ['estrategias', 'rpf', 'shadow'].includes(active);
  return (
    <>
      <header className="workspace-heading">
        <div><h1>{page.title}</h1><p>{page.detail}</p></div>
        <div className="workspace-heading-actions">
          <button className="workspace-account" onClick={() => onChange('monitor')} title="Abrir Cartera">
            <span>{lastUpdate ? (isStale(lastUpdate) ? 'Lectura anterior · ' : 'Cuenta · ') + fmtTime(lastUpdate) + ' ET' : 'Cuenta · sin fecha'}</span><strong>{preview ? 'Sin datos' : loadingBalances ? 'Leyendo…' : errorBalances || !balances ? 'Sin lectura' : fmtCurrency(balances.netLiquidatingValue)}</strong>
          </button>
          <button className="workspace-conversation" aria-label={conversationOpen ? 'Ocultar conversación' : 'Abrir conversación'}
            aria-pressed={conversationOpen} onClick={onConversation}><MessageSquare size={18} /><span>Conversación</span></button>
          {!preview && <AccountMenu onOpenSettings={() => onChange('config')} onLogout={onLogout} active={active === 'config'} />}
        </div>
      </header>
      {strategySection && <nav className="workspace-object-nav" aria-label="Vistas de estrategias">
        {([['estrategias', 'Catálogo'], ['rpf', 'RPF'], ['shadow', 'SHADOW']] as const).map(([id, label]) => (
          <button key={id} aria-current={active === id ? 'page' : undefined} onClick={() => onChange(id)}>{label}</button>
        ))}
      </nav>}
    </>
  );
}
