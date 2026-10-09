import React, { useEffect, useState } from 'react';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { fetchSpace, SpaceItem } from '../api/space';
import type { Tab } from '../components/layout/TabNav';
import { MARKET_TZ } from '../utils/formatters';

interface AlertView { id: string; motivo: string; detected_at: string; strategy: string }
interface Published {
  last_run?: { at?: string; result?: string; failed?: boolean };
  alerts?: AlertView[]; findings?: string; state_detail?: string;
}
function parse(item: SpaceItem): Published | null {
  try {
    const value = JSON.parse(item.content);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (value.last_run != null) {
      if (typeof value.last_run !== 'object' || Array.isArray(value.last_run)) return null;
      for (const key of ['at', 'result']) if (value.last_run[key] != null && typeof value.last_run[key] !== 'string') return null;
      if (value.last_run.failed != null && typeof value.last_run.failed !== 'boolean') return null;
    }
    if (value.state_detail != null && typeof value.state_detail !== 'string') return null;
    if (value.alerts != null && (!Array.isArray(value.alerts) || value.alerts.some((alert: AlertView) =>
      !alert || typeof alert.id !== 'string' || typeof alert.motivo !== 'string' || typeof alert.strategy !== 'string'))) return null;
    if (item.key === 'supervisor' && (!Array.isArray(value.alerts) ||
      !value.last_run || typeof value.last_run.at !== 'string' || Number.isNaN(Date.parse(value.last_run.at)) ||
      typeof value.last_run.failed !== 'boolean' || typeof value.last_run.result !== 'string')) return null;
    return value;
  }
  catch { return null; }
}
function date(value?: string): string {
  if (!value || Number.isNaN(Date.parse(value))) return 'Fecha no disponible';
  return new Date(value).toLocaleString('es-AR', { timeZone: MARKET_TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' ET';
}

/** Lectura de las publicaciones existentes; no genera resúmenes ni llama al modelo. */
export function Today({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const [items, setItems] = useState<SpaceItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (alive) setReading(true);
      try { const space = await fetchSpace(); if (alive) { setItems(space.items.filter(i => i.kind === 'agent')); setError(null); } }
      catch { if (alive) setError('No se pudieron leer las publicaciones. No podemos confirmar la actividad actual.'); }
      finally { if (alive) setReading(false); }
    };
    load(); const timer = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  const published = (items ?? []).map(item => ({ item, record: parse(item) }));
  const supervisor = published.find(p => p.item.key === 'supervisor');
  const alerts = Array.isArray(supervisor?.record?.alerts) ? supervisor!.record!.alerts!.filter(a =>
    a && typeof a.id === 'string' && typeof a.motivo === 'string') : [];
  const unreadable = published.filter(p => !p.record).length;
  return (
    <div className="today-workspace">
      <div className="today-intro"><p>Tu mesa de trabajo</p><h2>Qué merece una revisión</h2>
        <span>Lo publicado por el supervisor y los agentes. Cada resultado conserva su fecha.</span></div>
      {error && <p role="alert" className="today-error">{error} Lo anterior, si aparece, es la última lectura disponible.</p>}
      {unreadable > 0 && <p role="alert" className="today-error">Hay publicaciones que no se pudieron interpretar. Revisá el detalle en Agentes.</p>}
      <section className="today-section" aria-labelledby="today-attention">
        <div className="today-section-heading"><h3 id="today-attention">Avisos del supervisor</h3>
          <button onClick={() => onNavigate('shadow')}>Ver SHADOW <ArrowUpRight size={16} /></button></div>
        <p className="today-source">{supervisor ? 'Publicado ' + date(supervisor.item.updatedAt) : 'Sin publicación del supervisor'}
          {supervisor?.record?.last_run?.failed ? ' · La última revisión falló' : ''}</p>
        {supervisor?.record?.last_run?.failed && <p className="today-error">{supervisor.record.state_detail || 'No se pudo completar la revisión.'}</p>}
        {items === null && !error ? <p className="today-empty">Leyendo publicaciones…</p>
          : !supervisor || !supervisor.record ? <p className="today-empty">No hay una revisión legible para mostrar. Esto no confirma ausencia de avisos.</p>
          : alerts.length === 0 ? <p className="today-empty">Esta publicación no contiene avisos. Su fecha indica cuándo se revisó.</p>
          : <div className="today-attention-list">{alerts.slice(0, 5).map(a => <div key={a.id}>
              <p>{a.motivo}</p><span>{a.strategy} · {date(a.detected_at)}</span>
            </div>)}</div>}
      </section>
      <section className="today-section" aria-labelledby="today-activity">
        <div className="today-section-heading"><h3 id="today-activity">Últimos trabajos publicados</h3>
          <button onClick={() => onNavigate('agentes')}>Abrir agentes <ArrowUpRight size={16} /></button></div>
        <div className="today-activity-list">{published.filter(p => p.item.key !== 'supervisor' && p.record).map(({ item, record }) => (
          <div key={item.key}><div><strong>{item.title}</strong><p>{record!.last_run?.result || 'Todavía no hay una corrida publicada'}</p></div>
            <div><span>{date(record!.last_run?.at || item.updatedAt)}</span>{record!.last_run?.failed && <p className="today-error">La última corrida falló</p>}</div></div>
        ))}</div>
        {items && !published.some(p => p.item.key !== 'supervisor' && p.record) && <p className="today-empty">Todavía no hay trabajos legibles publicados.</p>}
      </section>
      <div className="today-reading"><RefreshCw size={14} /><span>{reading ? 'Leyendo…' : 'La vista vuelve a consultar cada minuto; la publicación depende de los agentes.'}</span></div>
    </div>
  );
}
