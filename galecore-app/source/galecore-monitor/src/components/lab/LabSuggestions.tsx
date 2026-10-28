import { useEffect, useState } from 'react';
import apiClient from '../../api/client';
import { fetchSpace, saveSpaceItem, SpaceItem } from '../../api/space';
import './LabSuggestions.css';

// Sugerencias del chat nuevo (WS-0039): la API elige hasta cuatro temas del momento; un clic arranca el chat con su
// pregunta. Se apagan desde Configuración → Usuario (`preference/sugerencias-chat`); sin la preferencia, prendidas.
export interface ChatSuggestion {
  id: string; kind: 'move' | 'event'; title: string; value: string; tone: 'up' | 'down' | 'neutral';
  series: number[]; asOf: string; question: string;
}
export const SUGGESTIONS_KEY = 'sugerencias-chat';

export function suggestionsEnabled(item?: SpaceItem): boolean {
  try { return item ? JSON.parse(item.content).enabled !== false : true; } catch { return true; }
}
export async function saveSuggestionsEnabled(enabled: boolean): Promise<void> {
  cached = null;
  await saveSpaceItem('preference', SUGGESTIONS_KEY, {
    title: 'Sugerencias en el chat nuevo', content: JSON.stringify({ enabled }), format: 'json', visibility: 'private',
  });
}

function Sparkline({ series }: { series: number[] }) {
  if (series.length < 2) return null;
  const min = Math.min(...series), max = Math.max(...series), span = max - min || 1;
  const points = series.map((v, i) => `${(i / (series.length - 1)) * 100},${28 - ((v - min) / span) * 26}`).join(' ');
  return <svg className="lab-suggestion-spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polyline points={points}/></svg>;
}

// El panel se monta cada vez que el chat queda vacío (Nuevo chat, cambio de proyecto) y la API tarda segundos en
// armar las tarjetas: se reusa la misma consulta por dos minutos.
const CACHE_MS = 120_000;
let cached: { at: number; items: Promise<ChatSuggestion[]> } | null = null;
export function clearSuggestionsCache() { cached = null; }

function loadSuggestions(): Promise<ChatSuggestion[]> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.items;
  const items = fetchSpace()
    .then(space => suggestionsEnabled(space.items.find(i => i.kind === 'preference' && i.key === SUGGESTIONS_KEY)))
    .catch(() => true)
    .then(enabled => enabled ? apiClient.get<{ items?: ChatSuggestion[] }>('/App/GaleCore/Lab/Suggestions', { timeout: 20_000 }) : null)
    .then(r => r?.data?.items ?? []);
  cached = { at: Date.now(), items };
  items.catch(() => { cached = null; });
  return items;
}

export function LabSuggestions({ onPick, disabled }: { onPick: (question: string) => void; disabled?: boolean }) {
  const [items, setItems] = useState<ChatSuggestion[]>([]);
  useEffect(() => {
    let active = true;
    loadSuggestions()
      .then(list => { if (active) setItems(list); })
      .catch(() => { /* Sin sugerencias el chat nuevo sigue igual: no es un error para el trader. */ });
    return () => { active = false; };
  }, []);
  if (!items.length) return null;
  return <div className="lab-suggestions" aria-label="Temas del momento">
    {items.map(s => <button key={s.id} type="button" className={'lab-suggestion ' + s.tone} disabled={disabled} onClick={() => onPick(s.question)}>
      <span className="lab-suggestion-head"><b>{s.title}</b><em>{s.value}</em></span>
      {s.kind === 'move' ? <Sparkline series={s.series}/> : <span className="lab-suggestion-date">{s.asOf}</span>}
      <span className="lab-suggestion-question">{s.question}</span>
      {s.kind === 'move' && s.asOf !== 'hoy' && s.asOf && <small>{s.asOf}</small>}
    </button>)}
  </div>;
}
