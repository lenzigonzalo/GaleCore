import React from 'react';
import { StrategySwitch } from '../common/StrategySwitch';
import { useAppConfigStore } from '../../store/useAppConfigStore';

/**
 * Configuración → Plataforma (owner 17/10): los servicios de datos y motores que corren solos se prenden y apagan acá,
 * en un solo lugar. Las estrategias se prenden en su ficha de Estrategias y las tareas en Agentes.
 * Apagar afecta a toda la plataforma: sólo lo ve un admin y la protección real es el 403 del backend.
 */
const WHAT: Record<string, { name: string; what: string }> = {
  gex: { name: 'Barrido de Gamma (GEX)', what: 'Recorre la cadena de opciones para calcular Gamma en Mercado. Apagado, Gamma no se actualiza y no se piden esos datos.' },
  skew: { name: 'Historia del skew', what: 'Cada 6 h guarda el skew de cada símbolo; de ahí sale la serie que usa RPF. Cada día apagado es un hueco en esa historia.' },
  runtime: { name: 'Motor SHADOW', what: 'Corre las estrategias simuladas: evalúa, abre y cierra en SHADOW. Nunca opera en la cuenta real.' },
};
export function PlatformServices() {
  const strategies = useAppConfigStore(s => s.strategies);
  const services = useAppConfigStore(s => s.services);
  const rows = [
    ...strategies.filter(s => s.id === 'gex' && s.switch_endpoint).map(s => ({ id: s.id, endpoint: s.switch_endpoint })),
    ...services.map(s => ({ id: s.id, endpoint: s.switch_endpoint })),
  ];
  if (!rows.length) return <p>No hay servicios declarados en la configuración de la plataforma.</p>;
  return <table className="platform-services"><thead><tr><th>Servicio</th><th>Qué hace</th><th>Estado</th></tr></thead><tbody>
    {rows.map(r => <tr key={r.id}><td>{WHAT[r.id]?.name || r.id}</td><td>{WHAT[r.id]?.what || services.find(s => s.id === r.id)?.description || '—'}</td><td><StrategySwitch endpoint={r.endpoint} title="Prender o apagar para toda la plataforma"/></td></tr>)}
  </tbody></table>;
}
