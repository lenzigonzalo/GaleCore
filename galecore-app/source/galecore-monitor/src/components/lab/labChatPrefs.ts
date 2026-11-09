// Preferencias del chat del Lab que son de este navegador (WS-0067): sonido al terminar, sonido al pedir permiso,
// volumen y aviso del navegador. Como el resto de las preferencias de pantalla: localStorage con try/catch.
import { useEffect, useState } from 'react';
import { DEFAULT_MODE, Engine, normalizeMode } from './chatPermissions';

export interface ChatPrefs {
  finishSound: boolean; permissionSound: boolean; volume: number; notify: boolean;
  /** Proveedor, modelo y esfuerzo con los que abre un chat nuevo ('' = el predeterminado del Lab). */
  provider: '' | 'codex' | 'claude'; model: string; effort: string;
  /** Permisos con los que abre un chat nuevo, por motor (ver chatPermissions). */
  modes: Record<Engine, string>;
}
const KEY = 'galecore:lab:chat-prefs';
const EVENT = 'galecore:lab:chat-prefs';
const DEFAULTS: ChatPrefs = { finishSound: true, permissionSound: true, volume: 0.5, notify: false, provider: '', model: '', effort: '', modes: { ...DEFAULT_MODE } };

export function readChatPrefs(): ChatPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    const volume = Number(raw.volume);
    return {
      finishSound: raw.finishSound !== false, permissionSound: raw.permissionSound !== false,
      volume: Number.isFinite(volume) && raw.volume !== undefined ? Math.min(1, Math.max(0, volume)) : DEFAULTS.volume,
      notify: raw.notify === true,
      provider: raw.provider === 'codex' || raw.provider === 'claude' ? raw.provider : '',
      model: typeof raw.model === 'string' ? raw.model : '', effort: typeof raw.effort === 'string' ? raw.effort : '',
      // `mode` ('manual' | 'auto') era el valor único de antes: se migra a los dos motores ('manual' = su predeterminado seguro).
      modes: { claude: normalizeMode('claude', raw.modes?.claude ?? raw.mode), codex: normalizeMode('codex', raw.modes?.codex ?? raw.mode) },
    };
  } catch { return { ...DEFAULTS }; }
}

export function saveChatPrefs(next: ChatPrefs) {
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* vale hasta recargar */ }
  window.dispatchEvent(new Event(EVENT));
}

let audio: AudioContext | null = null;
/** Sonido corto generado con WebAudio (sin archivos): «done» = dos notas que suben; «permission» = una nota doble y grave. */
export function playChatSound(kind: 'done' | 'permission', volume = readChatPrefs().volume) {
  try {
    const Context = window.AudioContext || (window as any).webkitAudioContext;
    if (!Context || volume <= 0) return;
    audio = audio || new Context();
    if (audio.state === 'suspended') void audio.resume();
    const notes = kind === 'done' ? [[660, 0], [880, 0.14]] : [[440, 0], [440, 0.18]];
    for (const [freq, at] of notes) {
      const osc = audio.createOscillator(), gain = audio.createGain(), t = audio.currentTime + at;
      osc.type = 'sine'; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume * 0.35), t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      osc.connect(gain); gain.connect(audio.destination); osc.start(t); osc.stop(t + 0.25);
    }
  } catch { /* sin audio: el chat sigue igual */ }
}

/** Aviso del navegador (sólo si la pestaña no se ve y la persona lo encendió). Un clic lleva al chat. */
export function notifyChat(title: string, body: string, onClick: () => void) {
  try {
    if (!readChatPrefs().notify || !document.hidden || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const n = new Notification(title, { body });
    n.onclick = () => { window.focus(); onClick(); n.close(); };
  } catch { /* sin avisos del navegador */ }
}

export const CHAT_PREFS_EVENT = EVENT;

/** Modos de permisos con los que abre cada chat nuevo; se actualiza al instante cuando se cambian en Configuración. */
export function useChatModes(): ChatPrefs['modes'] {
  const [modes, setModes] = useState(() => readChatPrefs().modes);
  useEffect(() => { const update = () => setModes(readChatPrefs().modes); window.addEventListener(EVENT, update); return () => window.removeEventListener(EVENT, update); }, []);
  return modes;
}
