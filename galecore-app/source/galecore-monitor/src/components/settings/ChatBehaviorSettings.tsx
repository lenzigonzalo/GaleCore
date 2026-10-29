import React, { useEffect, useState } from 'react';
import { Switch } from './LanguageSetting';
import { ChatPrefs, playChatSound, readChatPrefs, saveChatPrefs } from '../lab/labChatPrefs';
import { labRequest, WorkspaceState } from '../../api/lab';

/** Configuración → General → Chat (WS-0067): sonidos y aviso del navegador al terminar o pedir permiso. */
export function ChatBehaviorSettings() {
  const [prefs, setPrefs] = useState<ChatPrefs>(readChatPrefs);
  const [denied, setDenied] = useState(false);
  const [lab, setLab] = useState<WorkspaceState | null>(null);
  useEffect(() => { let alive = true; labRequest<WorkspaceState>('/workspaces').then(v => { if (alive) setLab(v); }).catch(() => {}); return () => { alive = false; }; }, []);
  const options = prefs.provider ? lab?.chatOptions?.[prefs.provider] : undefined;
  const efforts = options?.modelEfforts?.[prefs.model || options.defaultModel || ''] || options?.efforts || [];
  const change = (patch: Partial<ChatPrefs>) => { const next = { ...prefs, ...patch }; setPrefs(next); saveChatPrefs(next); };
  const toggleNotify = async (on: boolean) => {
    setDenied(false);
    if (!on) { change({ notify: false }); return; }
    try {
      const answer = typeof Notification === 'undefined' ? 'denied' : Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
      if (answer === 'granted') change({ notify: true }); else setDenied(true);
    } catch { setDenied(true); }
  };
  const names: Record<string, string> = { sonnet: 'Sonnet', opus: 'Opus', haiku: 'Haiku' };
  const levels: Record<string, string> = { low: 'Bajo', medium: 'Medio', high: 'Alto', xhigh: 'Muy alto', max: 'Máximo', ultra: 'Ultra' };
  return <div className="prefs">
    <section className="prefs-group">
      <h2>Chat</h2>
      <div className="prefs-row"><span>Sonido al terminar<small>Suena cuando el chat termina de responder</small></span>
        <Switch on={prefs.finishSound} label="Sonido al terminar" onChange={on => change({ finishSound: on })} /></div>
      <div className="prefs-row"><span>Sonido al pedir permiso<small>Suena cuando el chat necesita que decidas algo</small></span>
        <Switch on={prefs.permissionSound} label="Sonido al pedir permiso" onChange={on => change({ permissionSound: on })} /></div>
      <div className="prefs-row"><label htmlFor="chat-volume">Volumen</label>
        <div className="settings-language">
          <input id="chat-volume" type="range" min={0} max={100} step={5} value={Math.round(prefs.volume * 100)} onChange={e => change({ volume: Number(e.target.value) / 100 })} />
          <button type="button" className="btn" onClick={() => playChatSound('done', prefs.volume)}>Probar</button>
        </div></div>
      <div className="prefs-row"><span>Aviso del navegador<small>{denied ? 'El navegador no dio permiso para avisar.' : 'Si la pestaña no se ve, avisa con el nombre del chat'}</small></span>
        <Switch on={prefs.notify} label="Aviso del navegador" onChange={on => { void toggleNotify(on); }} /></div>
      <div className="prefs-row"><span>Al abrir un chat nuevo<small>Elegís el proveedor, el modelo y el esfuerzo con los que arranca cada chat; después se pueden cambiar en el chat</small></span>
        <div className="prefs-fields">
          <label><span>Proveedor</span>
            <select aria-label="Proveedor inicial" value={prefs.provider} onChange={e => change({ provider: e.target.value as ChatPrefs['provider'], model: '', effort: '' })}>
              <option value="">Predeterminado</option>
              {(lab?.providers || []).filter(p => p.installed).map(p => <option key={p.id} value={p.id}>{p.id === 'claude' ? 'Claude' : 'Codex'}</option>)}
            </select></label>
          <label><span>Modelo</span>
            <select aria-label="Modelo inicial" value={prefs.model} disabled={!options} onChange={e => change({ model: e.target.value, effort: '' })}>
              <option value="">Predeterminado</option>
              {(options?.models || []).map(m => <option key={m} value={m}>{names[m] || m}</option>)}
            </select></label>
          <label><span>Esfuerzo</span>
            <select aria-label="Esfuerzo inicial" value={prefs.effort} disabled={!options || (prefs.model || options.defaultModel || '').includes('haiku')} onChange={e => change({ effort: e.target.value })}>
              <option value="">Predeterminado</option>
              {efforts.map(v => <option key={v} value={v}>{levels[v] || v}</option>)}
            </select></label>
        </div></div>
      <div className="prefs-row"><span>Permisos al abrir un chat<small>Manual pregunta antes de lo que necesita permiso; Auto decide solo lo seguro</small></span>
        <div className="prefs-fields">
          <label><span>Permisos</span>
            <select aria-label="Permisos iniciales" value={prefs.mode} onChange={e => change({ mode: e.target.value === 'auto' ? 'auto' : 'manual' })}>
              <option value="manual">Manual</option><option value="auto">Auto</option>
            </select></label>
        </div></div>
    </section>
  </div>;
}
