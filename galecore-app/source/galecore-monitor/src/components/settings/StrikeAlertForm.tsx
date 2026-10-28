import React, { useState } from 'react';
import { saveSpaceItem, SpaceItem } from '../../api/space';
import { STRIKE_ALERT_DEFAULTS, STRIKE_ALERT_KEY, StrikeAlertSettings } from '../../api/account';

/** Lee la preferencia guardada; lo que falte toma el valor por defecto (apagado, 15 puntos, en horario de mercado). */
export function readStrikeSettings(item?: SpaceItem): StrikeAlertSettings {
  try { return { ...STRIKE_ALERT_DEFAULTS, ...(item ? JSON.parse(item.content) : {}) }; } catch { return { ...STRIKE_ALERT_DEFAULTS }; }
}

export async function saveStrikeSettings(s: StrikeAlertSettings): Promise<void> {
  await saveSpaceItem('preference', STRIKE_ALERT_KEY, {
    title: 'Aviso cerca del strike vendido', content: JSON.stringify(s), format: 'json', visibility: 'private',
  });
}

/**
 * Aviso cerca del strike vendido (WS-0036): suena en la campana cuando el precio se acerca a un strike vendido de la
 * cuenta real. Vigila los dos lados de un iron condor. Cada posición puede tener su propia distancia (en Inicio).
 */
export function StrikeAlertForm({ item, onChanged }: { item?: SpaceItem; onChanged: () => void }) {
  const [s, setS] = useState<StrikeAlertSettings>(() => readStrikeSettings(item));
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  // Toma lo guardado al abrirse; después manda lo que se edita (una recarga atrasada no pisa el último cambio).

  const save = async (next: StrikeAlertSettings) => {
    setS(next); setState('saving');
    try { await saveStrikeSettings(next); setState('saved'); onChanged(); } catch { setState('error'); }
  };
  const valid = Number.isFinite(s.distance) && s.distance > 0;

  return (
    <section className="strike-alert-form">
      <label className="saf-row">
        <input type="checkbox" checked={s.enabled} onChange={e => save({ ...s, enabled: e.target.checked })} />
        <span><b>Aviso cerca del strike vendido</b><small>Suena y abre la campana cuando el precio se acerca a un strike vendido.</small></span>
      </label>
      <div className="saf-row saf-distance" aria-disabled={!s.enabled}>
        <span>Avisar a</span>
        <input type="number" min={0} step={s.unit === 'pct' ? 0.1 : 1} value={Number.isFinite(s.distance) ? s.distance : ''}
          disabled={!s.enabled} aria-label="Distancia"
          onChange={e => setS({ ...s, distance: e.target.valueAsNumber })}
          onBlur={() => valid && save(s)} />
        <select value={s.unit} disabled={!s.enabled} aria-label="Unidad" onChange={e => save({ ...s, unit: e.target.value as StrikeAlertSettings['unit'] })}>
          <option value="points">puntos</option>
          <option value="pct">% del precio</option>
        </select>
        <span>del strike vendido</span>
      </div>
      <label className="saf-row">
        <input type="checkbox" checked={s.market_hours_only} disabled={!s.enabled}
          onChange={e => save({ ...s, market_hours_only: e.target.checked })} />
        <span>Sólo en horario de mercado <small>(9:30 a 16:00 de Nueva York)</small></span>
      </label>
      {Object.keys(s.by_position).length > 0 && <p className="saf-note">
        {Object.keys(s.by_position).length === 1 ? 'Una posición tiene' : `${Object.keys(s.by_position).length} posiciones tienen`} su propia distancia (se cambia en Inicio).
      </p>}
      <p className="saf-state" role="status">{!valid ? 'La distancia tiene que ser mayor que cero.'
        : state === 'saving' ? 'Guardando…' : state === 'saved' ? 'Guardado.' : state === 'error' ? 'No se pudo guardar.' : ''}</p>
    </section>
  );
}
