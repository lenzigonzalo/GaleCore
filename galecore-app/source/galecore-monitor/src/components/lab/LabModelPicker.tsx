import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, X } from 'lucide-react';
import type { ChatOptions, LabProvider } from '../../api/lab';
import './LabModelPicker.css';

type Provider = 'codex' | 'claude';
interface Choice { provider: Provider; model: string; effort: string }
interface Props extends Choice {
  providers: LabProvider[]; options?: Partial<Record<Provider, ChatOptions>>;
  locked: boolean; onChange: (choice: Choice) => void;
}
const label = (provider: Provider) => provider === 'claude' ? 'Claude' : 'Codex';
const modelNames: Record<string, string> = { sonnet: 'Sonnet', opus: 'Opus', haiku: 'Haiku' };
const modelLabel = (model: string) => (modelNames[model] || model.replace(/^gpt-/i, 'GPT-'));
const effortLabels: Record<string, string> = { low: 'Bajo', medium: 'Medio', high: 'Alto', xhigh: 'Muy alto', max: 'Máximo', ultra: 'Ultra' };

export function LabModelPicker({ provider, model, effort, providers, options, locked, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<React.CSSProperties>({});
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(390, window.innerWidth - 32);
      const above = rect.top - 16, below = window.innerHeight - rect.bottom - 16;
      const upward = above >= below;
      setPosition({ width, left: Math.max(16, Math.min(rect.right - width, window.innerWidth - width - 16)),
        maxHeight: Math.max(0, Math.min(470, upward ? above : below)),
        top: upward ? undefined : rect.bottom + 8,
        bottom: upward ? window.innerHeight - rect.top + 8 : undefined });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);
  const displayed = model || (!locked && options?.[provider]?.defaultModel) || '';
  const availableEfforts = options?.[provider]?.modelEfforts?.[displayed] || options?.[provider]?.efforts || [];
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    menu.current?.querySelector<HTMLButtonElement>('[role="option"]:not(:disabled)')?.focus({ preventScroll: true });
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  function choose(nextProvider: Provider, nextModel: string) {
    const supported = options?.[nextProvider]?.modelEfforts?.[nextModel] || options?.[nextProvider]?.efforts || [];
    const nextEffort = nextModel.includes('haiku') ? '' : supported.includes(effort) ? effort : '';
    onChange({ provider: nextProvider, model: nextModel, effort: nextEffort });
    setOpen(false); trigger.current?.focus();
  }
  return <div className="lab-provider-picker" ref={root}>
    <button className="lab-provider-trigger" type="button" ref={trigger} aria-haspopup="dialog" aria-expanded={open}
      aria-label={'Proveedor y modelo: ' + label(provider) + ' - ' + (displayed ? modelLabel(displayed) : 'Predeterminado')}
      onClick={() => setOpen(value => !value)}>
      <img src={'/providers/' + provider + '.png'} alt=""/>
      <span>{label(provider)} <span className="lab-provider-separator">—</span> {displayed ? modelLabel(displayed) : 'Predeterminado'}</span>
      <ChevronDown size={15}/>
    </button>
    {open && createPortal(<div ref={menu} style={position} className="lab-provider-menu" role="dialog" aria-label="Elegir proveedor y modelo">
      <header><strong>Proveedor y modelo</strong><button type="button" aria-label="Cerrar selector" onClick={() => { setOpen(false); trigger.current?.focus(); }}><X size={16}/></button></header>
      <div role="listbox" aria-label="Modelos del chat" onKeyDown={event => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)'));
        if (!buttons.length) return;
        event.preventDefault();
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next].focus();
      }}>
        {(['claude', 'codex'] as const).map(id => {
          const installed = providers.find(item => item.id === id)?.installed;
          const models = Array.from(new Set(['', ...(options?.[id]?.models || [])]));
          return <section key={id} role="group" aria-label={label(id)}>
            <h3>{label(id)}{!installed && <span> · No disponible en el Lab</span>}</h3>
            {models.map(value => <button key={value || 'default'} type="button" role="option"
              aria-selected={provider === id && model === value} disabled={locked || !installed}
              onClick={() => choose(id, value)}>
              <img src={'/providers/' + id + '.png'} alt=""/>
              <span>{label(id)} — {value ? modelLabel(value) : 'Predeterminado' + (options?.[id]?.defaultModel ? ' (' + modelLabel(options[id]!.defaultModel!) + ')' : '')}</span>
              {provider === id && model === value && <Check size={15}/>}
            </button>)}
          </section>;
        })}
      </div>
      {options?.[provider] && <label className="lab-provider-effort">Esfuerzo
        <select aria-label="Esfuerzo de la conversación" value={effort} disabled={locked || displayed.includes('haiku')}
          onChange={event => onChange({ provider, model, effort: event.target.value })}>
          <option value="">Predeterminado</option>{availableEfforts.map(value => <option key={value} value={value}>{effortLabels[value] || value}</option>)}
        </select>
      </label>}
      {locked && <p>Esta conversación conserva su selección. Abrí un nuevo chat para cambiarla.</p>}
    </div>, document.body)}
  </div>;
}
