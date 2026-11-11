import React, { useEffect, useState } from 'react';
import { deployShadowSpec, fetchShadowEvaluations, stopShadowInstance } from '../../api/shadow';
import { ShadowInstance, SpecVersionMetrics, StrategyCard } from '../../types/shadow';
import { agoText, num, usdAr } from './ficha';

function actionError(e: unknown): string {
  const any = e as { response?: { data?: { error?: string; reason?: string } }; message?: string };
  const d = any.response?.data;
  if (d?.error) return d.reason ? `${d.error} Motivo: ${d.reason}` : d.error;
  const status = (any.response as { status?: number } | undefined)?.status;
  // Sin respuesta de la API no hay nada más que decir; con una respuesta sin texto, el código es lo único que hay.
  return status ? `GaleCore respondió con el error ${status} y no dio el motivo.` : 'no se pudo conectar con GaleCore.';
}
const shortHash = (h: string) => h.replace('sha256:', '').slice(0, 12);
// Las lecturas auxiliares nunca rompen la ficha: si fallan (o la API no las tiene), el dato se omite.
function safe<T>(read: () => Promise<T>): Promise<T | null> { return Promise.resolve().then(read).catch(() => null); }

/** Estado de la estrategia bajo el encabezado: interruptor Prendida / Pausada, versión activa, capital y topes en USD, ventana y última evaluación. La tarjeta y las métricas las pide la ficha una vez y se pasan por props. */
export function StrategyStatusBar({ spec, instance, card = null, metrics = [], canControl, openPositions, onInstanceChange }: {
  spec: string; instance: ShadowInstance | null; card?: StrategyCard | null; metrics?: SpecVersionMetrics[]; canControl: boolean; openPositions?: number; onInstanceChange?: () => Promise<void> | void;
}) {
  const [lastEval, setLastEval] = useState<string | null | undefined>(undefined);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const hash = instance?.versionHash;
  const id = instance?.instanceId;
  // Versión legible de lo que corre: la de la tarjeta si es la misma spec, si no la de las métricas por hash.
  const version = !hash ? null : card?.contentHash === hash && card.version ? card.version : metrics.find(m => m.specName === spec && m.contentHash === hash)?.specVersion ?? null;
  useEffect(() => {
    let active = true; setLastEval(undefined); setConfirm(false);
    if (!id) return;
    safe(() => fetchShadowEvaluations(id, 1)).then(list => {
      if (active && list) setLastEval(list.length ? list.reduce((a, b) => Date.parse(b.evaluatedAt) > Date.parse(a.evaluatedAt) ? b : a).evaluatedAt : null);
    });
    return () => { active = false; };
  }, [id]);
  const running = instance?.lifecycleState === 'RUNNING';
  const run = async (action: () => Promise<void>, failure: string) => {
    setBusy(true); setError('');
    try { await action(); setConfirm(false); await onInstanceChange?.(); }
    catch (e) { setError(`${failure}: ${actionError(e)}`); }
    finally { setBusy(false); }
  };
  const l = card?.limitsUsd;
  const tz = (z: string) => z === 'America/New_York' ? 'hora NY' : z;
  const switchable = canControl && !!instance && (running || instance.lifecycleState === 'STOPPED');
  return <div className="strategy-status-bar" aria-label="Estado de la estrategia">
    {switchable && <span className="status-bar-action">
      <button type="button" role="switch" aria-checked={running} className="status-switch" disabled={busy} onClick={() => setConfirm(c => !c)}>
        <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>{running ? 'Prendida' : 'Pausada'}
      </button>
      {confirm && <span className="row-confirm">{running ? `¿Pausar? Deja de entrar${openPositions ? `; ${openPositions > 1 ? `las ${openPositions} abiertas se siguen valuando` : 'la abierta se sigue valuando'}` : ''}.` : `¿Prender de nuevo${version ? ` la v${version}` : ' la misma versión'}? Vuelve a evaluar entradas en SHADOW (simulado).`} <button type="button" className="row-action danger" disabled={busy}
        onClick={() => void (running ? run(() => stopShadowInstance(instance!.instanceId), 'No se pudo pausar') : run(() => deployShadowSpec(spec, instance!.versionHash), 'No se pudo prender'))}>Sí</button> <button type="button" className="row-action" disabled={busy} onClick={() => setConfirm(false)}>No</button></span>}
    </span>}
    {hash && <span><b>Versión activa</b> {version ? `v${version}` : shortHash(hash)}</span>}
    {l && l.capital !== null && <span><b>Capital simulado</b> {usdAr(l.capital)}</span>}
    {l && <span><b>Topes</b> por operación {usdAr(l.perTrade)} · riesgo abierto {usdAr(l.openRisk)} · por apuesta {usdAr(l.perBet)}</span>}
    {card?.window && <span><b>Ventana de entrada</b> {card.window.start}–{card.window.end} {tz(card.window.timezone)}</span>}
    {card && <span><b>Entradas por día</b> {card.maxEntriesPerDay === null ? '—' : num(card.maxEntriesPerDay)}</span>}
    {id && lastEval !== undefined && <span><b>Última evaluación</b> {lastEval ? agoText(lastEval) : 'sin evaluaciones'}</span>}
    {error && <p role="alert" className="status-bar-error">{error}</p>}
  </div>;
}
