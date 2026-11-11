import React, { useEffect, useState } from 'react';
import { deployShadowSpec, fetchShadowEvaluations, fetchShadowMetrics, fetchStrategyCard, stopShadowInstance } from '../../api/shadow';
import { ShadowInstance, StrategyCard } from '../../types/shadow';
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

/** Estado de la estrategia bajo el encabezado: versión activa, ventana, última evaluación, límites y Pausar / Prender. */
export function StrategyStatusBar({ spec, instance, canControl, openPositions, onInstanceChange }: {
  spec: string; instance: ShadowInstance | null; canControl: boolean; openPositions?: number; onInstanceChange?: () => Promise<void> | void;
}) {
  const [card, setCard] = useState<StrategyCard | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [lastEval, setLastEval] = useState<string | null | undefined>(undefined);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const hash = instance?.versionHash;
  const id = instance?.instanceId;
  useEffect(() => { let active = true; safe(() => fetchStrategyCard(spec)).then(c => { if (active) setCard(c); }); return () => { active = false; }; }, [spec]);
  useEffect(() => {
    let active = true; setVersion(null);
    if (!hash) return;
    if (card?.contentHash === hash && card.version) { setVersion(card.version); return; }
    safe(fetchShadowMetrics).then(list => { const found = list?.find(m => m.specName === spec && m.contentHash === hash); if (active) setVersion(found?.specVersion ?? null); });
    return () => { active = false; };
  }, [spec, hash, card]);
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
  return <div className="strategy-status-bar" aria-label="Estado de la estrategia">
    {hash && <span><b>Versión activa</b> {version ? `v${version}` : shortHash(hash)}</span>}
    {card?.window && <span><b>Ventana de entrada</b> {card.window.start}–{card.window.end} {card.window.timezone}</span>}
    {card && <span><b>Entradas por día</b> {card.maxEntriesPerDay === null ? '—' : num(card.maxEntriesPerDay)}</span>}
    {id && lastEval !== undefined && <span><b>Última evaluación</b> {lastEval ? agoText(lastEval) : 'sin evaluaciones'}</span>}
    {l && <span><b>Límites</b> por operación {usdAr(l.perTrade)} · riesgo abierto {usdAr(l.openRisk)} · por apuesta {usdAr(l.perBet)}</span>}
    {canControl && instance && (running || instance.lifecycleState === 'STOPPED') && <span className="status-bar-action">
      {confirm
        ? <span className="row-confirm">{running ? `¿Pausar? Deja de entrar${openPositions ? `; ${openPositions > 1 ? `las ${openPositions} abiertas se siguen valuando` : 'la abierta se sigue valuando'}` : ''}.` : `¿Prender de nuevo${version ? ` la v${version}` : ' la misma versión'}? Vuelve a evaluar entradas en SHADOW (simulado).`} <button type="button" className="row-action danger" disabled={busy}
          onClick={() => void (running ? run(() => stopShadowInstance(instance.instanceId), 'No se pudo pausar') : run(() => deployShadowSpec(spec, instance.versionHash), 'No se pudo prender'))}>Sí</button> <button type="button" className="row-action" disabled={busy} onClick={() => setConfirm(false)}>No</button></span>
        : <button type="button" className="row-action" onClick={() => setConfirm(true)}>{running ? 'Pausar' : 'Prender'}</button>}
    </span>}
    {error && <p role="alert" className="status-bar-error">{error}</p>}
  </div>;
}
