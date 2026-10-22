import React, { useEffect, useState } from 'react';
import { useStrategySwitchStore, useSwitchEntry } from '../../store/useStrategySwitchStore';
import { useCanManagePlatform } from '../../store/useCurrentUserStore';
import { useAppConfigStore } from '../../store/useAppConfigStore';
import { fetchSpace } from '../../api/space';

/**
 * Configuración → Plataforma (owner 17/10; WS-0057 A, 21/10): lo que GaleCore corre solo, para todos. Se muestra el
 * **estado** (corriendo, apagado, última vuelta), no un interruptor que parece opcional: apagar es una acción de admin,
 * aparte y con confirmación. El supervisor de SHADOW también vive acá (no lo crea el usuario: no va en Agentes).
 * La protección real de apagar es el 403 del backend.
 */
const WHAT: Record<string, { name: string; what: string }> = {
  gex: { name: 'Barrido de Gamma (GEX)', what: 'Recorre la cadena de opciones para calcular Gamma en Mercado. Apagado, Gamma no se actualiza.' },
  skew: { name: 'Historia del skew', what: 'Cada 6 h guarda el skew de cada símbolo; de ahí sale la serie que usa RPF. Cada día apagado es un hueco.' },
  runtime: { name: 'Motor SHADOW', what: 'Corre las estrategias simuladas: evalúa, abre y cierra en SHADOW. Nunca opera en la cuenta real.' },
};

// Mismo formato que Avisos y Agentes: «mié 21/10, 22:06».
function fmt(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = d.toLocaleDateString('es-AR', { weekday: 'short' }).replace('.', '');
  const date = d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
  return `${day} ${date}, ${d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}`;
}

function State({ tone, text, detail }: { tone: 'good' | 'off' | 'warn' | 'unknown'; text: string; detail?: string }) {
  return <span className={`platform-state is-${tone}`}><i />{text}{detail && <small>{detail}</small>}</span>;
}

function SwitchState({ endpoint }: { endpoint: string }) {
  const { enabled, error } = useSwitchEntry(endpoint);
  const read = useStrategySwitchStore((s) => s.read);
  useEffect(() => { read(endpoint); }, [endpoint, read]);
  if (error) return <State tone="warn" text="Sin respuesta" />;
  if (enabled == null) return <State tone="unknown" text="…" />;
  return enabled ? <State tone="good" text="Corriendo" /> : <State tone="off" text="Apagado" />;
}

function AdminAction({ endpoint }: { endpoint: string }) {
  const { enabled, busy } = useSwitchEntry(endpoint);
  const toggle = useStrategySwitchStore((s) => s.toggle);
  const [confirming, setConfirming] = useState(false);
  if (enabled == null) return null;
  if (!confirming) return <button className="settings-action platform-admin" disabled={busy} onClick={() => setConfirming(true)}>{enabled ? 'Apagar' : 'Prender'}</button>;
  return <span className="platform-confirm">{enabled ? '¿Apagar para todos?' : '¿Prender?'}
    <button className="settings-action" onClick={() => setConfirming(false)}>No</button>
    <button className={'settings-action ' + (enabled ? 'is-danger' : 'is-primary')} onClick={() => { setConfirming(false); void toggle(endpoint); }}>Sí</button>
  </span>;
}

interface SupervisorPiece { state?: string; last_run?: { at?: string; result?: string } | null; history?: { at?: string; result?: string }[] }

function SupervisorState() {
  const [piece, setPiece] = useState<SupervisorPiece | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    fetchSpace().then(({ items }) => {
      const item = items.find((i) => i.kind === 'agent' && i.key === 'supervisor');
      let parsed: SupervisorPiece | null = null;
      try { parsed = item ? JSON.parse(item.content) : null; } catch { parsed = null; }
      if (alive) setPiece(parsed);
    }).catch(() => { if (alive) setPiece(null); });
    return () => { alive = false; };
  }, []);
  if (piece === undefined) return <State tone="unknown" text="…" />;
  const last = piece?.last_run ?? piece?.history?.[0];
  if (!last?.at) return <State tone="unknown" text="Sin vueltas publicadas" />;
  const ok = last.result === 'OK';
  return <State tone={ok ? 'good' : 'warn'} text={ok ? 'Al día' : 'Última vuelta incompleta'} detail={fmt(last.at)} />;
}

export function PlatformServices() {
  const strategies = useAppConfigStore(s => s.strategies);
  const services = useAppConfigStore(s => s.services);
  const canManage = useCanManagePlatform();
  const rows = [
    ...strategies.filter(s => s.id === 'gex' && s.switch_endpoint).map(s => ({ id: s.id, endpoint: s.switch_endpoint })),
    ...services.map(s => ({ id: s.id, endpoint: s.switch_endpoint })),
  ];
  return <table className="platform-services"><thead><tr><th>Servicio</th><th>Qué hace</th><th>Estado</th>{canManage && <th />}</tr></thead><tbody>
    {rows.map(r => <tr key={r.id}>
      <td>{WHAT[r.id]?.name || r.id}</td>
      <td>{WHAT[r.id]?.what || services.find(s => s.id === r.id)?.description || '—'}</td>
      <td><SwitchState endpoint={r.endpoint} /></td>
      {canManage && <td><AdminAction endpoint={r.endpoint} /></td>}
    </tr>)}
    <tr>
      <td>Supervisor de SHADOW</td>
      <td>Cada 5 minutos revisa las reglas de lo abierto en SHADOW (stop, cierres, precio, límite) y guarda las decisiones. Corre en la PC del trader.</td>
      <td><SupervisorState /></td>
      {canManage && <td />}
    </tr>
  </tbody></table>;
}
