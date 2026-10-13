import React from 'react';
import { SlidersHorizontal } from 'lucide-react';
import type { ChatOptions } from '../../api/lab';

const EFFORT: Record<string, string> = { low: 'Bajo', medium: 'Medio', high: 'Alto', xhigh: 'Muy alto', max: 'Máximo' };
export function LabChatSettings({ options, model, effort, locked, onChange }: {
  options?: ChatOptions; model: string; effort: string; locked: boolean;
  onChange: (value: { model: string; effort: string }) => void;
}) {
  return <details className="lab-chat-settings" onKeyDown={e => {
    if (e.key !== 'Escape') return;
    e.currentTarget.open = false; e.currentTarget.querySelector('summary')?.focus();
  }}>
    <summary aria-label="Modelo y esfuerzo" title="Modelo y esfuerzo"><SlidersHorizontal size={15}/><span className="lab-settings-label">{model || 'Modelo y esfuerzo'}{effort && <span> · {EFFORT[effort] || effort}</span>}</span></summary>
    <div className="lab-settings-panel">{!options ? <p>La selección estará disponible al actualizar el Lab después de las pruebas en curso.</p> : <>
      <div className="lab-settings-fields">
        <label>Modelo<input aria-label="Modelo de la conversación" list="lab-model-options" placeholder="Predeterminado del servicio" maxLength={120} pattern="[a-zA-Z0-9][a-zA-Z0-9._:\-]*" value={model} disabled={locked}
          onChange={e => onChange({ model: e.target.value, effort: e.target.value.includes('haiku') ? '' : effort })}/></label>
        <datalist id="lab-model-options">{options.models.map(value => <option key={value} value={value}/>)}</datalist>
        <label>Esfuerzo<select aria-label="Esfuerzo de la conversación" value={effort} disabled={locked || model.includes('haiku')}
          onChange={e => onChange({ model, effort: e.target.value })}>
          <option value="">Predeterminado</option>{options.efforts.map(value => <option key={value} value={value}>{EFFORT[value] || value}</option>)}
        </select></label>
      </div>
      <p>{locked ? 'Esta conversación conserva su selección. Para cambiarla, abrí un nuevo chat.' : 'Usá un modelo disponible en tu cuenta. Más esfuerzo puede aumentar el tiempo y el consumo.'}</p>
    </>}</div>
  </details>;
}
